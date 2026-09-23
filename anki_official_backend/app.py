from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anki.buildinfo
import httpx
from anki import deck_config_pb2, import_export_pb2, scheduler_pb2, stats_pb2, notetypes_pb2
from anki.collection import (
    Collection,
    ExportAnkiPackageOptions,
    CardIdsLimit,
    NoteIdsLimit,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from anki.cards import Card
from anki.decks import DeckId, DeckCollapseScope
from anki.media import media_paths_from_col_path
from anki.scheduler.v3 import CardAnswer
from anki.sound import SoundOrVideoTag, TTSTag
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google.protobuf.json_format import MessageToDict, ParseDict
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

ANKI_VERSION = "26.09.2"
DATA_DIR = Path(os.environ.get("ANKI_DATA_DIR", "/data/anki-official")).resolve()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://gizhxgnbmmhhniubelbz.supabase.co").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
ORIGINS = [
    x.strip()
    for x in os.environ.get(
        "ALLOWED_ORIGINS",
        "https://studynomentor.github.io,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if x.strip()
]
MAX_IMPORT_BYTES = int(os.environ.get("ANKI_MAX_IMPORT_BYTES", str(512 * 1024 * 1024)))

app = FastAPI(
    title="StudyNoMentor — Anki Official Bridge",
    version=ANKI_VERSION,
    description="Thin authenticated bridge to the upstream Anki 26.09.2 Python/Rust backend.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

DATA_DIR.mkdir(parents=True, exist_ok=True)


def pb(msg: Any) -> dict[str, Any]:
    return MessageToDict(
        msg,
        preserving_proto_field_name=True,
        use_integers_for_enums=True,
    )


def deck_tree_payload(node: Any) -> dict[str, Any]:
    """Shape estável para a UI: apenas serializa os valores do DeckTreeNode oficial.

    Protobuf omite escalares no valor zero em JSON. O deck picker Android precisa
    distinguir "zero" de "campo inexistente", então explicitamos os zeros aqui,
    sem recalcular qualquer contagem.
    """
    return {
        "deck_id": int(node.deck_id),
        "name": str(node.name),
        "level": int(node.level),
        "collapsed": bool(node.collapsed),
        "review_count": int(node.review_count),
        "learn_count": int(node.learn_count),
        "new_count": int(node.new_count),
        "total_in_deck": int(node.total_in_deck),
        "total_including_children": int(node.total_including_children),
        "filtered": bool(node.filtered),
        "children": [deck_tree_payload(child) for child in node.children],
    }


@dataclass
class UserCollection:
    user_id: str
    root: Path
    collection_path: Path
    col: Collection
    lock: threading.RLock


class CollectionPool:
    def __init__(self) -> None:
        self._items: dict[str, UserCollection] = {}
        self._guard = threading.RLock()

    def get(self, user_id: str) -> UserCollection:
        with self._guard:
            existing = self._items.get(user_id)
            if existing:
                return existing
            root = DATA_DIR / user_id
            root.mkdir(parents=True, exist_ok=True)
            collection_path = root / "collection.anki2"
            col = Collection(str(collection_path))
            item = UserCollection(
                user_id=user_id,
                root=root,
                collection_path=collection_path,
                col=col,
                lock=threading.RLock(),
            )
            self._items[user_id] = item
            return item

    def close_all(self) -> None:
        with self._guard:
            for item in self._items.values():
                try:
                    item.col.close()
                except Exception:
                    pass
            self._items.clear()


pool = CollectionPool()


@app.on_event("shutdown")
def shutdown() -> None:
    pool.close_all()


async def current_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sessão do Study ausente.")
    if not SUPABASE_ANON_KEY:
        raise HTTPException(503, "SUPABASE_ANON_KEY não configurada no backend.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"Falha ao validar sessão do Study: {exc}") from exc
    if response.status_code != 200:
        raise HTTPException(401, "Sessão do Study inválida ou expirada.")
    user = response.json()
    if not user.get("id"):
        raise HTTPException(401, "Usuário do Study não identificado.")
    return user


def uc_for(user: dict[str, Any]) -> UserCollection:
    uid = str(user["id"])
    if not uid or any(ch not in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_" for ch in uid):
        raise HTTPException(400, "Identificador de usuário inválido.")
    return pool.get(uid)


def av_tags(card: Card, answer: bool = False) -> list[dict[str, Any]]:
    tags = card.answer_av_tags() if answer else card.question_av_tags()
    out: list[dict[str, Any]] = []
    for tag in tags:
        if isinstance(tag, SoundOrVideoTag):
            out.append({"kind": "media", "filename": tag.filename})
        elif isinstance(tag, TTSTag):
            out.append(
                {
                    "kind": "tts",
                    "field_text": tag.field_text,
                    "lang": tag.lang,
                    "voices": list(tag.voices),
                    "speed": tag.speed,
                    "other_args": list(tag.other_args),
                }
            )
    return out


def queued_payload(col: Collection) -> dict[str, Any]:
    queued = col.sched.get_queued_cards(fetch_limit=1)
    counts = {
        "new": int(queued.new_count),
        "learning": int(queued.learning_count),
        "review": int(queued.review_count),
    }
    if not queued.cards:
        return {"finished": True, "counts": counts}
    q = queued.cards[0]
    card = col.get_card(q.card.id)
    labels = list(col.sched.describe_next_states(q.states))
    note = card.note()
    note_type = note.note_type() or {}
    conf = col.decks.config_dict_for_deck_id(card.current_deck_id())
    return {
        "finished": False,
        "counts": counts,
        "queue": int(q.queue),
        "context": pb(q.context),
        "card": {
            "id": int(card.id),
            "note_id": int(card.nid),
            "deck_id": int(card.did),
            "deck_name": col.decks.name(card.did),
            "notetype_name": str(note_type.get("name", "")),
            "marked": "marked" in note.tags,
            "flag": int(card.user_flag()),
            "question": card.question(),
            "answer": card.answer(),
            "question_av_tags": av_tags(card, False),
            "answer_av_tags": av_tags(card, True),
            "auto_advance": {
                "seconds_to_show_question": float(conf.get("secondsToShowQuestion", 0) or 0),
                "seconds_to_show_answer": float(conf.get("secondsToShowAnswer", 0) or 0),
                "question_action": int(conf.get("questionAction", 0) or 0),
                "answer_action": int(conf.get("answerAction", 0) or 0),
                "wait_for_audio": bool(conf.get("waitForAudio", False)),
                "show_timer": bool(conf.get("timer", False)),
                "stop_timer_on_answer": bool(conf.get("stopTimerOnAnswer", False)),
                "max_answer_seconds": int(conf.get("maxTaken", 0) or 0),
            },
            "states": pb(q.states),
            "buttons": [
                {"rating": idx + 1, "label": label}
                for idx, label in enumerate(labels)
            ],
        },
    }


class SelectDeckBody(BaseModel):
    deck_id: int


class CreateDeckBody(BaseModel):
    name: str


class NoteUpdateBody(BaseModel):
    fields: dict[str, str]
    tags: list[str] = []


class AnswerBody(BaseModel):
    card_id: int
    rating: int = Field(ge=1, le=4)
    milliseconds_taken: int = Field(default=0, ge=0, le=86_400_000)


class TypeAnswerBody(BaseModel):
    provided: str = ""


class CardActionBody(BaseModel):
    action: str
    card_ids: list[int]
    value: str | int | None = None


class AddNoteBody(BaseModel):
    deck_id: int | None = None
    notetype_id: int | None = None
    fields: dict[str, str]
    tags: list[str] = []


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "engine": "anki",
        "pinned_version": ANKI_VERSION,
        "runtime_version": getattr(anki.buildinfo, "version", ANKI_VERSION),
        "build": "railpack",
        "data_dir": str(DATA_DIR),
    }


@app.get("/api/anki/status")
def status(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {
            "connected": True,
            "engine": "Anki official",
            "pinned_version": ANKI_VERSION,
            "runtime_version": getattr(anki.buildinfo, "version", ANKI_VERSION),
            "collection_path": item.collection_path.name,
            "cards": int(item.col.card_count()),
            "notes": int(item.col.note_count()),
            "current_deck_id": int(item.col.decks.get_current_id()),
            "qt_gui": False,
            "traditional_qt_addons": False,
        }


@app.get("/api/anki/decks")
def decks(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        values = item.col.decks.all_names_and_ids()
        due_tree = item.col.sched.deck_due_tree()
        return {
            "current_deck_id": int(item.col.decks.get_current_id()),
            "decks": [
                {"id": int(getattr(d, "id", 0)), "name": d.name}
                for d in values
            ],
            # A mesma árvore que abastece a lista de decks do Anki: hierarquia,
            # estado collapsed e contagens já submetidas aos limites do scheduler.
            "deck_tree": deck_tree_payload(due_tree),
        }


@app.post("/api/anki/decks/create")
def create_deck(body: CreateDeckBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Informe o nome do baralho.")
    with item.lock:
        out = item.col.decks.add_normal_deck_with_name(name)
        return {"ok": True, "deck_id": int(out.id), "name": name}


@app.post("/api/anki/decks/select")
def select_deck(body: SelectDeckBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        item.col.decks.select(DeckId(body.deck_id))
        return {"ok": True, "current_deck_id": int(item.col.decks.get_current_id())}


TYPE_ANSWER_PATTERN = re.compile(r"\\[\\[type:(.+?)\\]\\]")


def type_answer_context(col: Collection, card: Card) -> dict[str, Any] | None:
    question = card.question()
    match = TYPE_ANSWER_PATTERN.search(question)
    if not match:
        return None

    pattern = match.group(1)
    field_name = pattern
    combining = True
    cloze_idx: int | None = None
    if field_name.startswith("cloze:"):
        cloze_idx = int(card.ord) + 1
        field_name = field_name.split(":", 1)[1]
    if field_name.startswith("nc:"):
        combining = False
        field_name = field_name.split(":", 1)[1]

    note = card.note()
    note_type = card.note_type()
    field = next((f for f in note_type.get("flds", []) if f.get("name") == field_name), None)
    if not field:
        return {
            "enabled": False,
            "pattern": pattern,
            "question_html": TYPE_ANSWER_PATTERN.sub(
                f"[campo de resposta desconhecido: {field_name}]", question, count=1
            ),
        }

    expected = note[field_name]
    if cloze_idx is not None:
        expected = col.extract_cloze_for_typing(expected, cloze_idx) or ""

    if not expected:
        return {
            "enabled": False,
            "pattern": pattern,
            "question_html": TYPE_ANSWER_PATTERN.sub("", question, count=1),
        }

    return {
        "enabled": True,
        "pattern": pattern,
        "field_name": field_name,
        "expected": expected,
        "combining": combining,
        "font": str(field.get("font", "")),
        "size": int(field.get("size", 20) or 20),
        "question_html": TYPE_ANSWER_PATTERN.sub("", question, count=1),
    }


def reviewer_payload(col: Collection) -> dict[str, Any]:
    out = queued_payload(col)
    if not out.get("finished"):
        card = col.get_card(int(out["card"]["id"]))
        ctx = type_answer_context(col, card)
        if ctx:
            safe = {k: v for k, v in ctx.items() if k != "expected"}
            out["card"]["type_answer"] = safe
    return out


@app.get("/api/anki/reviewer/next")
def reviewer_next(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return reviewer_payload(item.col)


@app.post("/api/anki/reviewer/type-answer/{card_id}")
def reviewer_type_answer(
    card_id: int,
    body: TypeAnswerBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        card = item.col.get_card(card_id)
        ctx = type_answer_context(item.col, card)
        if not ctx or not ctx.get("enabled"):
            return {
                "enabled": False,
                "answer_html": TYPE_ANSWER_PATTERN.sub("", card.answer()),
            }

        comparison = item.col.compare_answer(
            str(ctx["expected"]),
            body.provided,
            bool(ctx["combining"]),
        )
        answer_html = card.answer()
        had_separator = '<hr id=answer>' in answer_html
        stripped = answer_html.replace('<hr id=answer>', '')
        replacement = (
            f'<div class="anki-type-answer-comparison" '
            f'style="font-family:{ctx["font"]};font-size:{ctx["size"]}px">'
            f'{comparison}</div>'
        )
        if had_separator:
            replacement = '<hr id=answer>' + replacement

        if TYPE_ANSWER_PATTERN.search(stripped):
            answer_html = TYPE_ANSWER_PATTERN.sub(replacement, stripped, count=1)
        else:
            answer_html = card.answer()

        return {
            "enabled": True,
            "answer_html": answer_html,
            "comparison": comparison,
        }


@app.post("/api/anki/reviewer/answer")
def reviewer_answer(body: AnswerBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        queued = item.col.sched.get_queued_cards(fetch_limit=1)
        if not queued.cards:
            raise HTTPException(409, "A fila oficial não possui card atual.")
        q = queued.cards[0]
        if int(q.card.id) != body.card_id:
            raise HTTPException(409, "O card atual da fila oficial mudou; recarregue o reviewer.")
        card = item.col.get_card(q.card.id)
        card.start_timer()
        rating = {
            1: CardAnswer.AGAIN,
            2: CardAnswer.HARD,
            3: CardAnswer.GOOD,
            4: CardAnswer.EASY,
        }[body.rating]
        answer = item.col.sched.build_answer(card=card, states=q.states, rating=rating)
        answer.milliseconds_taken = body.milliseconds_taken
        item.col.sched.answer_card(answer)
        return reviewer_payload(item.col)


@app.post("/api/anki/cards/action")
def card_action(body: CardActionBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    ids = [int(x) for x in body.card_ids]
    if not ids:
        raise HTTPException(400, "Nenhum card informado.")
    with item.lock:
        if body.action == "suspend":
            item.col.sched.suspend_cards(ids)
        elif body.action == "unsuspend":
            item.col.sched.unsuspend_cards(ids)
        elif body.action == "bury":
            item.col.sched.bury_cards(ids, manual=True)
        elif body.action == "unbury":
            item.col.sched.unbury_cards(ids)
        elif body.action == "forget":
            item.col.sched.schedule_cards_as_new(ids, reset_counts=False)
        elif body.action == "set_due":
            if body.value is None:
                raise HTTPException(400, "Informe a data relativa do Anki, ex.: 5 ou 5-7.")
            item.col.sched.set_due_date(ids, str(body.value))
        elif body.action == "flag":
            flag = int(body.value or 0)
            if flag < 0 or flag > 7:
                raise HTTPException(400, "Flag deve estar entre 0 e 7.")
            item.col.set_user_flag_for_cards(flag, ids)
        elif body.action == "mark":
            for cid in ids:
                note = item.col.get_card(cid).note()
                if "marked" in note.tags:
                    note.tags = [tag for tag in note.tags if tag != "marked"]
                else:
                    note.tags.append("marked")
                item.col.update_note(note)
        elif body.action == "delete_notes":
            item.col.remove_notes_by_card(ids)
        else:
            raise HTTPException(400, f"Ação oficial não exposta: {body.action}")
        return {"ok": True}


@app.get("/api/anki/browser/search")
def browser_search(
    q: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    sort_key: str = Query(default=""),
    reverse: bool = Query(default=False),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        order = True
        if sort_key:
            order = item.col.get_browser_column(sort_key)
            if order is None:
                raise HTTPException(400, f"Coluna de ordenação desconhecida: {sort_key}")
        all_ids = list(item.col.find_cards(q, order=order, reverse=reverse))
        ids = all_ids[offset:offset + limit]
        rows = []
        for cid in ids:
            card = item.col.get_card(cid)
            note = card.note()
            note_type = note.note_type() or {}
            rows.append(
                {
                    "card_id": int(card.id),
                    "note_id": int(card.nid),
                    "deck_id": int(card.did),
                    "deck_name": item.col.decks.name(card.did),
                    "notetype_name": str(note_type.get("name", "")),
                    "question": card.question(browser=True),
                    "answer": card.answer(),
                    "fields": dict(note.items()),
                    "tags": list(note.tags),
                    "marked": "marked" in note.tags,
                    "queue": int(card.queue),
                    "type": int(card.type),
                    "due": int(card.due),
                    "interval": int(card.ivl),
                    "reps": int(card.reps),
                    "lapses": int(card.lapses),
                    "flags": int(card.flags),
                    "flag": int(card.user_flag()),
                }
            )
        return {
            "query": q,
            "count": len(rows),
            "total": len(all_ids),
            "offset": offset,
            "limit": limit,
            "cards": rows,
        }


@app.get("/api/anki/notetypes")
def notetypes(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        values = item.col.models.all_names_and_ids()
        out = []
        for n in values:
            nt = item.col.models.get(int(getattr(n, "id", 0)))
            out.append(
                {
                    "id": int(getattr(n, "id", 0)),
                    "name": n.name,
                    "fields": [
                        field.get("name", "")
                        for field in (nt or {}).get("flds", [])
                        if field.get("name")
                    ],
                }
            )
        return {"notetypes": out}


@app.post("/api/anki/notes")
def add_note(body: AddNoteBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        nt = item.col.models.get(body.notetype_id) if body.notetype_id else item.col.models.current()
        if not nt:
            raise HTTPException(404, "Tipo de nota não encontrado.")
        note = item.col.new_note(nt)
        valid = set(note.keys())
        for name, value in body.fields.items():
            if name in valid:
                note[name] = value
        note.tags = list(body.tags)
        did = DeckId(body.deck_id or int(item.col.decks.get_current_id()))
        changes = item.col.add_note(note, did)
        return {"ok": True, "note_id": int(note.id), "changes": pb(changes)}


@app.get("/api/anki/card/{card_id}/detail")
def card_detail(card_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        card = item.col.get_card(card_id)
        note = card.note()
        note_type = note.note_type() or {}
        return {
            "card_id": int(card.id),
            "note_id": int(note.id),
            "deck_id": int(card.did),
            "deck_name": item.col.decks.name(card.did),
            "notetype_name": str(note_type.get("name", "")),
            "fields": dict(note.items()),
            "tags": list(note.tags),
            "flag": int(card.user_flag()),
            "marked": "marked" in note.tags,
            "queue": int(card.queue),
            "type": int(card.type),
            "due": int(card.due),
            "interval": int(card.ivl),
            "reps": int(card.reps),
            "lapses": int(card.lapses),
        }


@app.put("/api/anki/note/{note_id}")
def update_note(note_id: int, body: NoteUpdateBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        note = item.col.get_note(note_id)
        valid = set(note.keys())
        for name, value in body.fields.items():
            if name in valid:
                note[name] = value
        note.tags = list(body.tags)
        item.col.update_note(note)
        return {"ok": True, "note_id": int(note.id)}


@app.get("/api/anki/card/{card_id}/stats")
def card_stats(card_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.card_stats_data(card_id))


@app.get("/api/anki/deck/{deck_id}/options")
def deck_options(deck_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.decks.get_deck_configs_for_update(DeckId(deck_id)))


@app.get("/api/anki/browser/columns")
def browser_columns(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {
            "columns": [pb(column) for column in item.col.all_browser_columns()],
            "active_cards": list(item.col.load_browser_card_columns()),
            "active_notes": list(item.col.load_browser_note_columns()),
        }


@app.put("/api/anki/browser/columns")
def set_browser_columns(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    mode = str(payload.get("mode", "cards")).strip().lower()
    columns = [str(x) for x in payload.get("columns", []) if str(x).strip()]
    if mode not in {"cards", "notes"}:
        raise HTTPException(400, "Modo do navegador deve ser cards ou notes.")
    if not columns:
        raise HTTPException(400, "Selecione ao menos uma coluna.")
    with item.lock:
        valid = {str(column.key) for column in item.col.all_browser_columns()}
        invalid = [key for key in columns if key not in valid]
        if invalid:
            raise HTTPException(400, f"Colunas desconhecidas: {', '.join(invalid)}")
        if mode == "notes":
            item.col.set_browser_note_columns(columns)
        else:
            item.col.set_browser_card_columns(columns)
        return {
            "ok": True,
            "mode": mode,
            "columns": columns,
            "active_cards": list(item.col.load_browser_card_columns()),
            "active_notes": list(item.col.load_browser_note_columns()),
        }


@app.put("/api/anki/deck/{deck_id}/options")
def update_deck_options(
    deck_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        # A UI edita o mesmo objeto retornado por DeckConfigsForUpdate. O
        # backend oficial, porém, recebe UpdateDeckConfigsRequest. Convertemos
        # apenas a forma da mensagem; os valores continuam sendo interpretados
        # e aplicados exclusivamente pelo Anki.
        if "all_config" in payload:
            request_payload = {
                "target_deck_id": deck_id,
                "configs": [
                    entry.get("config", {})
                    for entry in payload.get("all_config", [])
                    if isinstance(entry, dict) and entry.get("config")
                ],
                "removed_config_ids": payload.get("removed_config_ids", []),
                "mode": payload.get("mode", 0),
                "card_state_customizer": payload.get("card_state_customizer", ""),
                "limits": (payload.get("current_deck") or {}).get("limits", {}),
                "new_cards_ignore_review_limit": payload.get("new_cards_ignore_review_limit", False),
                "fsrs": payload.get("fsrs", False),
                "apply_all_parent_limits": payload.get("apply_all_parent_limits", False),
                "fsrs_reschedule": payload.get("fsrs_reschedule", False),
                "fsrs_health_check": payload.get("fsrs_health_check", False),
            }
        else:
            request_payload = dict(payload)
            request_payload.setdefault("target_deck_id", deck_id)

        request = deck_config_pb2.UpdateDeckConfigsRequest()
        try:
            ParseDict(request_payload, request, ignore_unknown_fields=False)
        except Exception as exc:
            raise HTTPException(400, f"Deck Options inválidas: {exc}") from exc
        item.col.decks.update_deck_configs(request)
        return pb(item.col.decks.get_deck_configs_for_update(DeckId(deck_id)))


@app.get("/api/anki/media/check")
def media_check(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.media.check())


@app.post("/api/anki/editor/media")
async def editor_media(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    data = await file.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Arquivo de mídia excede o limite configurado.")
    item = uc_for(user)
    with item.lock:
        desired = os.path.basename(file.filename or "media")
        desired = item.col.media.add_extension_based_on_mime(
            desired,
            file.content_type or "application/octet-stream",
        )
        stored = item.col.media.write_data(desired, data)
        return {
            "ok": True,
            "filename": stored,
            "content_type": file.content_type or "application/octet-stream",
        }


@app.get("/api/anki/media/{filename:path}")
def media_file(filename: str, user: dict[str, Any] = Depends(current_user)):
    item = uc_for(user)
    safe_name = os.path.basename(filename)
    if safe_name != filename:
        raise HTTPException(400, "Nome de mídia inválido.")
    path = Path(item.col.media.dir()) / safe_name
    if not path.is_file():
        raise HTTPException(404, "Mídia não encontrada.")
    return FileResponse(path)


@app.post("/api/anki/database/check")
def check_database(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        message, ok = item.col.fix_integrity()
        return {"ok": ok, "message": message}


@app.post("/api/anki/database/optimize")
def optimize_database(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        item.col.optimize()
        return {"ok": True}


@app.post("/api/anki/undo")
def undo(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.undo())


@app.post("/api/anki/redo")
def redo(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.redo())


@app.post("/api/anki/import/apkg")
async def import_apkg(
    package: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = package.filename or "import.apkg"
    if not name.lower().endswith((".apkg", ".zip")):
        raise HTTPException(400, "Use um pacote .apkg do Anki.")
    data = await package.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Pacote excede o limite configurado.")
    item = uc_for(user)
    fd, tmp = tempfile.mkstemp(suffix=".apkg")
    os.close(fd)
    try:
        Path(tmp).write_bytes(data)
        with item.lock:
            request = ImportAnkiPackageRequest(
                package_path=tmp,
                options=ImportAnkiPackageOptions(
                    merge_notetypes=True,
                    update_notes=import_export_pb2.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_IF_NEWER,
                    update_notetypes=import_export_pb2.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_IF_NEWER,
                    with_scheduling=True,
                    with_deck_configs=True,
                ),
            )
            result = item.col.import_anki_package(request)
            return pb(result)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.get("/api/anki/export/apkg")
def export_apkg(user: dict[str, Any] = Depends(current_user)):
    item = uc_for(user)
    fd, tmp = tempfile.mkstemp(suffix=".apkg")
    os.close(fd)
    with item.lock:
        item.col.export_anki_package(
            out_path=tmp,
            options=ExportAnkiPackageOptions(
                with_scheduling=True,
                with_deck_configs=True,
                with_media=True,
                legacy=False,
            ),
            limit=None,
        )
    return FileResponse(
        tmp,
        filename="StudyNoMentor-Anki.apkg",
        media_type="application/octet-stream",
        background=BackgroundTask(lambda: os.path.exists(tmp) and os.unlink(tmp)),
    )


@app.post("/api/anki/import/colpkg")
async def import_colpkg(
    package: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = package.filename or "collection.colpkg"
    if not name.lower().endswith(".colpkg"):
        raise HTTPException(400, "Use um pacote .colpkg do Anki.")
    data = await package.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Pacote excede o limite configurado.")
    item = uc_for(user)
    fd, tmp = tempfile.mkstemp(suffix=".colpkg")
    os.close(fd)
    Path(tmp).write_bytes(data)
    try:
        with item.lock:
            backup = item.root / "before-colpkg-import.anki2"
            if item.collection_path.exists():
                shutil.copy2(item.collection_path, backup)
            backend = item.col._backend
            item.col.close()
            media_folder, media_db = media_paths_from_col_path(str(item.collection_path))
            backend.import_collection_package(
                import_export_pb2.ImportCollectionPackageRequest(
                    col_path=str(item.collection_path),
                    backup_path=tmp,
                    media_folder=media_folder,
                    media_db=media_db,
                )
            )
            item.col.reopen()
            return {"ok": True, "cards": int(item.col.card_count()), "notes": int(item.col.note_count())}
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.get("/api/anki/export/colpkg")
def export_colpkg(user: dict[str, Any] = Depends(current_user)):
    item = uc_for(user)
    fd, tmp = tempfile.mkstemp(suffix=".colpkg")
    os.close(fd)
    with item.lock:
        item.col.export_collection_package(tmp, include_media=True, legacy=False)
        item.col.reopen()
    return FileResponse(
        tmp,
        filename="StudyNoMentor-Anki.colpkg",
        media_type="application/octet-stream",
        background=BackgroundTask(lambda: os.path.exists(tmp) and os.unlink(tmp)),
    )


# ---------------------------------------------------------------------------
# Superfícies avançadas do Anki Oficial
# ---------------------------------------------------------------------------

@app.post("/api/anki/decks/manage")
def manage_deck(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    action = str(payload.get("action", "")).strip()
    deck_id = DeckId(int(payload.get("deck_id") or 0))
    with item.lock:
        if action == "rename":
            name = str(payload.get("name", "")).strip()
            if not name:
                raise HTTPException(400, "Informe o novo nome do baralho.")
            item.col.decks.rename(deck_id, name)
        elif action == "delete":
            item.col.decks.remove([deck_id])
        elif action == "reparent":
            parent_id = DeckId(int(payload.get("parent_id") or 0))
            item.col.decks.reparent([deck_id], parent_id)
        elif action == "collapse":
            item.col.decks.set_collapsed(
                deck_id,
                bool(payload.get("collapsed", True)),
                DeckCollapseScope.REVIEWER,
            )
        elif action == "unbury":
            item.col.sched.unbury_deck(deck_id)
        else:
            raise HTTPException(400, f"Ação de baralho não suportada: {action}")
        return {"ok": True, "decks": decks(user)}


@app.get("/api/anki/browser/notes")
def browser_notes(
    q: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    sort_key: str = Query(default=""),
    reverse: bool = Query(default=False),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        order = True
        if sort_key:
            order = item.col.get_browser_column(sort_key)
            if order is None:
                raise HTTPException(400, f"Coluna de ordenação desconhecida: {sort_key}")
        all_ids = list(item.col.find_notes(q, order=order, reverse=reverse))
        ids = all_ids[offset:offset + limit]
        rows = []
        for nid in ids:
            note = item.col.get_note(nid)
            nt = note.note_type() or {}
            cids = [int(x) for x in item.col.card_ids_of_note(nid)]
            cards = []
            for cid in cids:
                card = item.col.get_card(cid)
                cards.append(
                    {
                        "card_id": int(card.id),
                        "deck_id": int(card.did),
                        "deck_name": item.col.decks.name(card.did),
                        "queue": int(card.queue),
                        "type": int(card.type),
                        "due": int(card.due),
                        "interval": int(card.ivl),
                        "reps": int(card.reps),
                        "lapses": int(card.lapses),
                        "flag": int(card.user_flag()),
                    }
                )
            rows.append(
                {
                    "note_id": int(note.id),
                    "notetype_id": int(nt.get("id", 0) or 0),
                    "notetype_name": str(nt.get("name", "")),
                    "fields": dict(note.items()),
                    "tags": list(note.tags),
                    "marked": "marked" in note.tags,
                    "cards": cards,
                }
            )
        return {
            "query": q,
            "count": len(rows),
            "total": len(all_ids),
            "offset": offset,
            "limit": limit,
            "notes": rows,
        }


@app.get("/api/anki/browser/facets")
def browser_facets(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {
            "tags": list(item.col.tags.all()),
            "decks": [
                {"id": int(getattr(d, "id", 0)), "name": d.name}
                for d in item.col.decks.all_names_and_ids()
            ],
            "notetypes": [
                {"id": int(getattr(n, "id", 0)), "name": n.name}
                for n in item.col.models.all_names_and_ids()
            ],
        }


@app.post("/api/anki/browser/bulk")
def browser_bulk(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    action = str(payload.get("action", "")).strip()
    card_ids = [int(x) for x in payload.get("card_ids", [])]
    note_ids = [int(x) for x in payload.get("note_ids", [])]
    with item.lock:
        if action == "move_deck":
            if not card_ids:
                raise HTTPException(400, "Selecione cards.")
            item.col.set_deck(card_ids, int(payload.get("deck_id") or 0))
        elif action == "suspend_cards":
            item.col.sched.suspend_cards(card_ids)
        elif action == "unsuspend_cards":
            item.col.sched.unsuspend_cards(card_ids)
        elif action == "bury_cards":
            item.col.sched.bury_cards(card_ids, manual=True)
        elif action == "unbury_cards":
            item.col.sched.unbury_cards(card_ids)
        elif action == "suspend_notes":
            item.col.sched.suspend_notes(note_ids)
        elif action == "bury_notes":
            item.col.sched.bury_notes(note_ids)
        elif action == "forget":
            item.col.sched.schedule_cards_as_new(
                card_ids,
                restore_position=bool(payload.get("restore_position", False)),
                reset_counts=bool(payload.get("reset_counts", False)),
            )
        elif action == "set_due":
            item.col.sched.set_due_date(card_ids, str(payload.get("days") or "0"))
        elif action == "reposition":
            item.col.sched.reposition_new_cards(
                card_ids=card_ids,
                starting_from=max(0, int(payload.get("starting_from") or 1)),
                step_size=max(1, int(payload.get("step_size") or 1)),
                randomize=bool(payload.get("randomize", False)),
                shift_existing=bool(payload.get("shift_existing", False)),
            )
        elif action == "flag":
            flag = max(0, min(7, int(payload.get("flag") or 0)))
            item.col.set_user_flag_for_cards(flag, card_ids)
        elif action == "tags_add":
            item.col.tags.bulk_add(note_ids, str(payload.get("tags") or ""))
        elif action == "tags_remove":
            item.col.tags.bulk_remove(note_ids, str(payload.get("tags") or ""))
        elif action == "delete_notes":
            item.col.remove_notes(note_ids)
        elif action == "find_replace":
            out = item.col.find_and_replace(
                note_ids=note_ids,
                search=str(payload.get("search") or ""),
                replacement=str(payload.get("replacement") or ""),
                regex=bool(payload.get("regex", False)),
                field_name=str(payload.get("field_name") or "") or None,
                match_case=bool(payload.get("match_case", False)),
            )
            return {"ok": True, "changes": pb(out)}
        elif action == "change_notetype":
            if not note_ids:
                raise HTTPException(400, "Selecione notas.")
            target = int(payload.get("target_notetype_id") or 0)
            old = int(item.col.models.get_single_notetype_of_notes(note_ids))
            info = item.col.models.change_notetype_info(
                old_notetype_id=old,
                new_notetype_id=target,
            )
            request = info.input
            request.ClearField("note_ids")
            request.note_ids.extend(note_ids)
            out = item.col.models.change_notetype_of_notes(request)
            return {"ok": True, "changes": pb(out)}
        else:
            raise HTTPException(400, f"Ação em massa não suportada: {action}")
        return {"ok": True}


@app.get("/api/anki/browser/duplicates")
def browser_duplicates(
    field: str = Query(..., min_length=1),
    search: str = Query(default=""),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        rows = item.col.find_dupes(field, search)
        return {
            "field": field,
            "groups": [
                {"value": value, "note_ids": [int(nid) for nid in nids]}
                for value, nids in rows
            ],
        }


@app.get("/api/anki/stats/graphs")
def collection_graphs(
    search: str = Query(default=""),
    days: int = Query(default=365, ge=0, le=36500),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col._backend.graphs(search=search, days=days))


@app.post("/api/anki/fsrs/optimize")
def fsrs_optimize(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    request = scheduler_pb2.ComputeFsrsParamsRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise HTTPException(400, f"Parâmetros FSRS inválidos: {exc}") from exc
    with item.lock:
        return pb(
            item.col._backend.compute_fsrs_params(
                search=request.search,
                current_params=list(request.current_params),
                ignore_revlogs_before_ms=request.ignore_revlogs_before_ms,
                num_of_relearning_steps=request.num_of_relearning_steps,
                health_check=request.health_check,
            )
        )


@app.post("/api/anki/fsrs/simulate")
def fsrs_simulate(
    payload: dict[str, Any],
    mode: str = Query(default="review"),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    request = scheduler_pb2.SimulateFsrsReviewRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise HTTPException(400, f"Simulação FSRS inválida: {exc}") from exc
    with item.lock:
        kwargs = {
            "params": list(request.params),
            "desired_retention": request.desired_retention,
            "deck_size": request.deck_size,
            "days_to_simulate": request.days_to_simulate,
            "new_limit": request.new_limit,
            "review_limit": request.review_limit,
            "max_interval": request.max_interval,
            "search": request.search,
            "new_cards_ignore_review_limit": request.new_cards_ignore_review_limit,
            "easy_days_percentages": list(request.easy_days_percentages),
            "review_order": request.review_order,
            "historical_retention": request.historical_retention,
            "learning_step_count": request.learning_step_count,
            "relearning_step_count": request.relearning_step_count,
        }
        if request.HasField("suspend_after_lapse_count"):
            kwargs["suspend_after_lapse_count"] = request.suspend_after_lapse_count
        if mode == "workload":
            return pb(item.col._backend.simulate_fsrs_workload(**kwargs))
        if mode == "optimal":
            return pb(item.col._backend.compute_optimal_retention(**kwargs))
        return pb(item.col._backend.simulate_fsrs_review(**kwargs))


@app.get("/api/anki/custom-study/defaults/{deck_id}")
def custom_study_defaults(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        out = item.col.sched.custom_study_defaults(DeckId(deck_id))
        return {
            "tags": [
                {
                    "name": str(tag.name),
                    "include": bool(tag.include),
                    "exclude": bool(tag.exclude),
                }
                for tag in out.tags
            ],
            "extend_new": int(out.extend_new),
            "extend_review": int(out.extend_review),
            "available_new": int(out.available_new),
            "available_review": int(out.available_review),
            "available_new_in_children": int(out.available_new_in_children),
            "available_review_in_children": int(out.available_review_in_children),
        }


@app.post("/api/anki/custom-study")
def custom_study(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    request = scheduler_pb2.CustomStudyRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise HTTPException(400, f"Estudo personalizado inválido: {exc}") from exc
    with item.lock:
        return {"ok": True, "changes": pb(item.col.sched.custom_study(request))}


@app.get("/api/anki/filtered-deck/{deck_id}")
def get_filtered_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {
            "deck": pb(item.col.sched.get_or_create_filtered_deck(DeckId(deck_id))),
            "orders": list(item.col.sched.filtered_deck_order_labels()),
        }


@app.put("/api/anki/filtered-deck/{deck_id}")
def update_filtered_deck(
    deck_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        current = item.col.sched.get_or_create_filtered_deck(DeckId(deck_id))
        try:
            ParseDict(payload, current, ignore_unknown_fields=False)
        except Exception as exc:
            raise HTTPException(400, f"Baralho filtrado inválido: {exc}") from exc
        out = item.col.sched.add_or_update_filtered_deck(current)
        return {"ok": True, "deck_id": int(out.id), "deck": pb(current)}


@app.post("/api/anki/filtered-deck/{deck_id}/rebuild")
def rebuild_filtered_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {"ok": True, "changes": pb(item.col.sched.rebuild_filtered_deck(DeckId(deck_id)))}


@app.post("/api/anki/filtered-deck/{deck_id}/empty")
def empty_filtered_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {"ok": True, "changes": pb(item.col.sched.empty_filtered_deck(DeckId(deck_id)))}


@app.get("/api/anki/empty-cards")
def empty_cards_report(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.get_empty_cards())


@app.post("/api/anki/empty-cards/delete")
def delete_empty_cards(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    ids = [int(x) for x in payload.get("card_ids", [])]
    with item.lock:
        out = item.col.remove_cards_and_orphaned_notes(ids)
        return {"ok": True, "changes": pb(out)}


@app.post("/api/anki/media/trash")
def media_trash(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    files = [os.path.basename(str(x)) for x in payload.get("files", [])]
    with item.lock:
        item.col.media.trash_files(files)
        return {"ok": True, "count": len(files)}


@app.post("/api/anki/media/restore-trash")
def media_restore_trash(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        item.col.media.restore_trash()
        return {"ok": True}


@app.post("/api/anki/media/empty-trash")
def media_empty_trash(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        item.col.media.empty_trash()
        return {"ok": True}


@app.get("/api/anki/notetypes/full")
def notetypes_full(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        rows = []
        for nt in item.col.models.all():
            rows.append(
                {
                    "notetype": nt,
                    "use_count": int(item.col.models.use_count(nt)),
                }
            )
        return {"notetypes": rows}


@app.post("/api/anki/notetypes/create")
def create_notetype(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Informe o nome do tipo de nota.")
    with item.lock:
        source_id = int(payload.get("source_id") or 0)
        source = item.col.models.get(source_id) if source_id else item.col.models.current()
        if not source:
            raise HTTPException(404, "Tipo de nota de origem não encontrado.")
        clone = item.col.models.copy(source, add=False)
        clone["name"] = name
        out = item.col.models.add(clone)
        return {"ok": True, "notetype_id": int(out.id)}


@app.put("/api/anki/notetypes/{notetype_id}")
def update_notetype(
    notetype_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        nt = dict(payload.get("notetype") or payload)
        nt["id"] = int(notetype_id)
        item.col.models.update_dict(nt)
        updated = item.col.models.get(notetype_id)
        return {"ok": True, "notetype": updated}


@app.post("/api/anki/notetypes/{notetype_id}/schema")
def mutate_notetype_schema(
    notetype_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    action = str(payload.get("action", "")).strip()
    with item.lock:
        nt = item.col.models.get(notetype_id)
        if not nt:
            raise HTTPException(404, "Tipo de nota não encontrado.")
        if action == "add_field":
            name = str(payload.get("name", "")).strip()
            if not name:
                raise HTTPException(400, "Informe o nome do campo.")
            field = item.col.models.new_field(name)
            item.col.models.add_field(nt, field)
        elif action == "remove_field":
            ordinal = int(payload.get("ordinal", -1))
            if ordinal < 0 or ordinal >= len(nt.get("flds", [])):
                raise HTTPException(400, "Campo inválido.")
            item.col.models.remove_field(nt, nt["flds"][ordinal])
        elif action == "add_template":
            name = str(payload.get("name", "")).strip() or f"Card {len(nt.get('tmpls', [])) + 1}"
            template = item.col.models.new_template(name)
            template["qfmt"] = str(payload.get("qfmt", "{{Front}}"))
            template["afmt"] = str(payload.get("afmt", "{{FrontSide}}<hr id=answer>{{Back}}"))
            item.col.models.add_template(nt, template)
        elif action == "remove_template":
            ordinal = int(payload.get("ordinal", -1))
            if ordinal < 0 or ordinal >= len(nt.get("tmpls", [])):
                raise HTTPException(400, "Template inválido.")
            item.col.models.remove_template(nt, nt["tmpls"][ordinal])
        elif action == "move_field":
            source = int(payload.get("source", -1))
            target = int(payload.get("target", -1))
            if source < 0 or source >= len(nt.get("flds", [])):
                raise HTTPException(400, "Campo inválido.")
            item.col.models.reposition_field(nt, nt["flds"][source], target)
        elif action == "move_template":
            source = int(payload.get("source", -1))
            target = int(payload.get("target", -1))
            if source < 0 or source >= len(nt.get("tmpls", [])):
                raise HTTPException(400, "Template inválido.")
            item.col.models.reposition_template(nt, nt["tmpls"][source], target)
        else:
            raise HTTPException(400, f"Ação de schema não suportada: {action}")
        item.col.models.update_dict(nt)
        updated = item.col.models.get(notetype_id)
        return {"ok": True, "notetype": updated}


@app.delete("/api/anki/notetypes/{notetype_id}")
def delete_notetype(
    notetype_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {"ok": True, "changes": pb(item.col.models.remove(notetype_id))}


@app.get("/api/anki/notetypes/change-info")
def change_notetype_info(
    old_notetype_id: int = Query(...),
    new_notetype_id: int = Query(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(
            item.col.models.change_notetype_info(
                old_notetype_id=old_notetype_id,
                new_notetype_id=new_notetype_id,
            )
        )


@app.post("/api/anki/notetypes/change")
def change_notetype(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    request = notetypes_pb2.ChangeNotetypeRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise HTTPException(400, f"Mudança de tipo inválida: {exc}") from exc
    with item.lock:
        return {"ok": True, "changes": pb(item.col.models.change_notetype_of_notes(request))}


@app.post("/api/anki/import/csv/metadata")
async def csv_metadata(
    package: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    data = await package.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Arquivo excede o limite configurado.")
    suffix = Path(package.filename or "import.csv").suffix or ".csv"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    Path(tmp).write_bytes(data)
    item = uc_for(user)
    try:
        with item.lock:
            return pb(item.col.get_csv_metadata(tmp, None))
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.post("/api/anki/import/csv")
async def import_csv(
    package: UploadFile = File(...),
    metadata_json: str | None = Form(default=None),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    data = await package.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Arquivo excede o limite configurado.")
    suffix = Path(package.filename or "import.csv").suffix or ".csv"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    Path(tmp).write_bytes(data)
    item = uc_for(user)
    try:
        with item.lock:
            metadata = item.col.get_csv_metadata(tmp, None)
            if metadata_json:
                try:
                    raw = json.loads(metadata_json)
                    ParseDict(raw, metadata, ignore_unknown_fields=False)
                except Exception as exc:
                    raise HTTPException(400, f"Metadata CSV inválida: {exc}") from exc
            request = import_export_pb2.ImportCsvRequest(path=tmp, metadata=metadata)
            return pb(item.col.import_csv(request))
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.get("/api/anki/export/notes.csv")
def export_notes_csv(
    html: bool = Query(default=True),
    tags: bool = Query(default=True),
    deck: bool = Query(default=True),
    notetype: bool = Query(default=True),
    guid: bool = Query(default=True),
    user: dict[str, Any] = Depends(current_user),
):
    item = uc_for(user)
    fd, tmp = tempfile.mkstemp(suffix=".txt")
    os.close(fd)
    with item.lock:
        item.col.export_note_csv(
            out_path=tmp,
            limit=None,
            with_html=html,
            with_tags=tags,
            with_deck=deck,
            with_notetype=notetype,
            with_guid=guid,
        )
    return FileResponse(
        tmp,
        filename="StudyNoMentor-Anki-notes.txt",
        media_type="text/plain; charset=utf-8",
        background=BackgroundTask(lambda: os.path.exists(tmp) and os.unlink(tmp)),
    )


@app.get("/api/anki/export/cards.csv")
def export_cards_csv(
    html: bool = Query(default=True),
    user: dict[str, Any] = Depends(current_user),
):
    item = uc_for(user)
    fd, tmp = tempfile.mkstemp(suffix=".txt")
    os.close(fd)
    with item.lock:
        item.col.export_card_csv(out_path=tmp, limit=None, with_html=html)
    return FileResponse(
        tmp,
        filename="StudyNoMentor-Anki-cards.txt",
        media_type="text/plain; charset=utf-8",
        background=BackgroundTask(lambda: os.path.exists(tmp) and os.unlink(tmp)),
    )


@app.post("/api/anki/image-occlusion/setup")
def image_occlusion_setup(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        item.col.add_image_occlusion_notetype()
        matches = []
        for nt in item.col.models.all():
            stock = int(nt.get("originalStockKind", nt.get("original_stock_kind", 0)) or 0)
            if stock == 6:
                matches.append({"id": int(nt["id"]), "name": nt.get("name", "Image Occlusion")})
        return {"ok": True, "notetypes": matches}


@app.post("/api/anki/image-occlusion/image")
async def image_occlusion_image(
    image: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    data = await image.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Imagem excede o limite configurado.")
    item = uc_for(user)
    safe_name = os.path.basename(image.filename or "image.png")
    with item.lock:
        stored = item.col.media.write_data(safe_name, data)
        return {"ok": True, "filename": stored}


@app.post("/api/anki/image-occlusion/note")
def add_image_occlusion_note(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        out = item.col.add_image_occlusion_note(
            notetype_id=int(payload.get("notetype_id") or 0),
            image_path=str(payload.get("image_path") or ""),
            occlusions=str(payload.get("occlusions") or ""),
            header=str(payload.get("header") or ""),
            back_extra=str(payload.get("back_extra") or ""),
            tags=[str(x) for x in payload.get("tags", [])],
        )
        return {"ok": True, "changes": pb(out)}


@app.get("/api/anki/image-occlusion/note/{note_id}")
def get_image_occlusion_note(
    note_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return pb(item.col.get_image_occlusion_note(note_id))


@app.put("/api/anki/image-occlusion/note/{note_id}")
def update_image_occlusion_note(
    note_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        out = item.col.update_image_occlusion_note(
            note_id=note_id,
            occlusions=payload.get("occlusions"),
            header=payload.get("header"),
            back_extra=payload.get("back_extra"),
            tags=[str(x) for x in payload.get("tags", [])] if "tags" in payload else None,
        )
        return {"ok": True, "changes": pb(out)}
