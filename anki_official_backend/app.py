from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anki.buildinfo
import httpx
from anki import deck_config_pb2, import_export_pb2
from anki.collection import (
    Collection,
    ExportAnkiPackageOptions,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from anki.cards import Card
from anki.decks import DeckId
from anki.media import media_paths_from_col_path
from anki.scheduler.v3 import CardAnswer
from anki.sound import SoundOrVideoTag, TTSTag
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
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
    return {
        "finished": False,
        "counts": counts,
        "queue": int(q.queue),
        "context": pb(q.context),
        "card": {
            "id": int(card.id),
            "note_id": int(card.nid),
            "deck_id": int(card.did),
            "question": card.question(),
            "answer": card.answer(),
            "question_av_tags": av_tags(card, False),
            "answer_av_tags": av_tags(card, True),
            "states": pb(q.states),
            "buttons": [
                {"rating": idx + 1, "label": label}
                for idx, label in enumerate(labels)
            ],
        },
    }


class SelectDeckBody(BaseModel):
    deck_id: int


class AnswerBody(BaseModel):
    card_id: int
    rating: int = Field(ge=1, le=4)
    milliseconds_taken: int = Field(default=0, ge=0, le=86_400_000)


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
        return {
            "current_deck_id": int(item.col.decks.get_current_id()),
            "decks": [
                {"id": int(getattr(d, "id", 0)), "name": d.name}
                for d in values
            ],
        }


@app.post("/api/anki/decks/select")
def select_deck(body: SelectDeckBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        item.col.decks.select(DeckId(body.deck_id))
        return {"ok": True, "current_deck_id": int(item.col.decks.get_current_id())}


@app.get("/api/anki/reviewer/next")
def reviewer_next(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return queued_payload(item.col)


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
        return queued_payload(item.col)


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
            item.col.set_user_flag_for_cards(ids, flag)
        elif body.action == "delete_notes":
            item.col.remove_notes_by_card(ids)
        else:
            raise HTTPException(400, f"Ação oficial não exposta: {body.action}")
        return {"ok": True}


@app.get("/api/anki/browser/search")
def browser_search(
    q: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=1000),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        ids = list(item.col.find_cards(q, order=True))[:limit]
        rows = []
        for cid in ids:
            card = item.col.get_card(cid)
            note = card.note()
            rows.append(
                {
                    "card_id": int(card.id),
                    "note_id": int(card.nid),
                    "deck_id": int(card.did),
                    "question": card.question(browser=True),
                    "answer": card.answer(),
                    "fields": dict(note.items()),
                    "tags": list(note.tags),
                    "queue": int(card.queue),
                    "type": int(card.type),
                    "due": int(card.due),
                    "interval": int(card.ivl),
                    "reps": int(card.reps),
                    "lapses": int(card.lapses),
                    "flags": int(card.flags),
                }
            )
        return {"query": q, "count": len(rows), "cards": rows}


@app.get("/api/anki/notetypes")
def notetypes(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        values = item.col.models.all_names_and_ids()
        return {
            "notetypes": [
                {"id": int(getattr(n, "id", 0)), "name": n.name}
                for n in values
            ]
        }


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
        return {"columns": [pb(column) for column in item.col.all_browser_columns()]}


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
