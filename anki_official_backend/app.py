from __future__ import annotations

import asyncio
import hashlib
import html
import json
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anki.buildinfo
import httpx
from anki import cards_pb2, deck_config_pb2, import_export_pb2, scheduler_pb2, stats_pb2, notetypes_pb2
from anki.collection import (
    Collection,
    ExportAnkiPackageOptions,
    CardIdsLimit,
    NoteIdsLimit,
    DeckIdLimit,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from anki.cards import Card
from anki.decks import DeckId, DeckCollapseScope
from anki.errors import CardTypeError
from anki.media import media_paths_from_col_path
from anki.scheduler.v3 import CardAnswer
from anki.sound import SoundOrVideoTag, TTSTag
from anki.stdmodels import StockNotetypeKind
from anki.foreign_data import mnemosyne
from anki.utils import from_json_bytes
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google.protobuf.json_format import MessageToDict, ParseDict
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

ANKI_VERSION = "26.09.3"


def verify_anki_runtime() -> str:
    """Recusa outro motor antes de abrir ou alterar qualquer coleção."""
    runtime = getattr(anki.buildinfo, "version", None)
    if runtime != ANKI_VERSION:
        raise RuntimeError(
            f"Anki runtime incompatível: esperado {ANKI_VERSION}, recebido {runtime!r}. "
            "Instale anki_official_backend/requirements.txt antes de iniciar o backend."
        )
    return runtime


ANKI_RUNTIME_VERSION = verify_anki_runtime()
DATA_DIR = Path(os.environ.get("ANKI_DATA_DIR", "/data/anki-official")).resolve()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://gizhxgnbmmhhniubelbz.supabase.co").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
ORIGINS = [
    x.strip()
    for x in os.environ.get(
        "ALLOWED_ORIGINS",
        # Produção só aceita a origem publicada. Para desenvolvimento local,
        # defina ALLOWED_ORIGINS explicitamente (ex.: http://localhost:8000).
        "https://studynomentor.github.io",
    ).split(",")
    if x.strip()
]
MAX_IMPORT_BYTES = int(os.environ.get("ANKI_MAX_IMPORT_BYTES", str(512 * 1024 * 1024)))
MAX_MEDIA_BYTES = int(os.environ.get("ANKI_MAX_MEDIA_BYTES", str(100 * 1024 * 1024)))
MAX_OPEN_COLLECTIONS = max(1, int(os.environ.get("ANKI_MAX_OPEN_COLLECTIONS", "32")))
TOKEN_CACHE_SECONDS = max(0, int(os.environ.get("ANKI_TOKEN_CACHE_SECONDS", "60")))
UPLOAD_CHUNK = 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    review_sessions.close_all()
    pool.close_all()
    cards_pool.close_all()


app = FastAPI(
    lifespan=lifespan,
    title="StudyNoMentor — Anki Official Bridge",
    version=ANKI_VERSION,
    description="Thin authenticated bridge to the upstream Anki 26.09.3 Python/Rust backend.",
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


class ReservedCollectionLock:
    """RLock que libera a reserva criada por CollectionPool.get() ao sair do uso.

    A reserva fecha a janela get(item) -> acquire(lock): enquanto o chamador ainda
    possui uma referência recém-entregue, a LRU não pode fechar aquela Collection.
    """

    def __init__(self, raw: threading.RLock, on_exit: Any) -> None:
        self._raw = raw
        self._on_exit = on_exit

    def acquire(self, *args: Any, **kwargs: Any) -> bool:
        return self._raw.acquire(*args, **kwargs)

    def release(self) -> None:
        self._raw.release()

    def __enter__(self) -> "ReservedCollectionLock":
        self._raw.acquire()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        try:
            self._raw.release()
        finally:
            self._on_exit()


@dataclass
class UserCollection:
    user_id: str
    root: Path
    collection_path: Path
    col: Collection
    lock: Any
    last_used: float = field(default_factory=time.monotonic)
    reservations: int = 0


class CollectionPool:
    """Coleções abertas por usuário, com teto (LRU).

    Sem teto, cada usuário que já usou o backend mantinha uma coleção SQLite
    aberta para sempre: memória e descritores cresciam sem limite. A mais
    antiga só é fechada quando ninguém a está usando (lock livre)."""

    def __init__(self, max_open: int = MAX_OPEN_COLLECTIONS, namespace: str = "") -> None:
        self._items: "OrderedDict[str, UserCollection]" = OrderedDict()
        self._guard = threading.RLock()
        self._max_open = max_open
        self._namespace = namespace.strip().strip("/")

    def _evict_locked(self) -> None:
        while len(self._items) > self._max_open:
            victim_id = None
            for uid, item in self._items.items():
                if item.reservations:
                    continue
                if item.lock.acquire(blocking=False):
                    try:
                        item.col.close()
                    except Exception:
                        pass
                    finally:
                        item.lock.release()
                    victim_id = uid
                    break
            if victim_id is None:
                return  # todas em uso: tenta de novo na próxima abertura
            self._items.pop(victim_id, None)

    def get(self, user_id: str) -> UserCollection:
        with self._guard:
            existing = self._items.get(user_id)
            if existing:
                existing.last_used = time.monotonic()
                existing.reservations += 1
                self._items.move_to_end(user_id)
                return existing
            root = DATA_DIR / user_id
            if self._namespace:
                root = root / self._namespace
            root.mkdir(parents=True, exist_ok=True)
            collection_path = root / "collection.anki2"
            col = Collection(str(collection_path))
            raw_lock = threading.RLock()
            item = UserCollection(
                user_id=user_id,
                root=root,
                collection_path=collection_path,
                col=col,
                lock=raw_lock,
                reservations=1,
            )
            item.lock = ReservedCollectionLock(
                raw_lock,
                lambda uid=user_id: self._release_reservation(uid),
            )
            self._items[user_id] = item
            self._evict_locked()
            return item

    def _release_reservation(self, user_id: str) -> None:
        with self._guard:
            item = self._items.get(user_id)
            if item:
                item.reservations = max(0, item.reservations - 1)
                item.last_used = time.monotonic()
                self._items.move_to_end(user_id)
            self._evict_locked()

    def release_unlocked_reference(self, item: UserCollection) -> None:
        self._release_reservation(item.user_id)

    def close_all(self) -> None:
        with self._guard:
            for item in self._items.values():
                try:
                    item.col.close()
                except Exception:
                    pass
            self._items.clear()


pool = CollectionPool()
# Coleção isolada usada pela tela Cards. Ela executa o MESMO backend oficial
# do Anki, mas nunca mistura os cards do Study com a coleção do menu Anki Oficial.
cards_pool = CollectionPool(namespace="study-cards")


@dataclass
class ReviewSession:
    user_id: str
    session_id: str
    collection_path: Path
    col: Collection
    card_ids: tuple[int, ...]
    label: str
    deck_id: int
    version: str
    lock: threading.RLock = field(default_factory=threading.RLock)
    last_used: float = field(default_factory=time.monotonic)


class ReviewSessionPool:
    """Snapshots efêmeros por navegador/aparelho, usados só para COLETA da fila.

    O snapshot contém apenas os cards do recorte. Assim o scheduler oficial aplica
    limites e ordenação depois do filtro, sem suspender/mover/reagendar a Collection
    real. Respostas continuam sendo gravadas somente na Collection real.
    """

    def __init__(self, max_open: int = 96) -> None:
        self._guard = threading.RLock()
        self._items: "OrderedDict[str, ReviewSession]" = OrderedDict()
        self._max_open = max(4, max_open)

    def _key(self, user_id: str, session_id: str) -> str:
        return f"{user_id}:{session_id}"

    @staticmethod
    def _validate_session_id(session_id: str) -> str:
        value = str(session_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9._:-]{8,160}", value):
            raise HTTPException(400, "Identificador da sessão de revisão inválido.")
        return value

    def _close(self, session: ReviewSession) -> None:
        try:
            session.col.close()
        except Exception:
            pass
        try:
            session.collection_path.unlink(missing_ok=True)
        except OSError:
            pass

    def _evict_locked(self) -> None:
        while len(self._items) > self._max_open:
            key, session = next(iter(self._items.items()))
            if not session.lock.acquire(blocking=False):
                self._items.move_to_end(key)
                break
            try:
                self._items.pop(key, None)
                self._close(session)
            finally:
                session.lock.release()

    def drop(self, user_id: str, session_id: str) -> None:
        key = self._key(user_id, self._validate_session_id(session_id))
        with self._guard:
            session = self._items.pop(key, None)
        if session:
            with session.lock:
                self._close(session)

    def create(
        self,
        source: UserCollection,
        session_id: str,
        card_ids: list[int] | None,
        label: str,
        deck_id: int,
    ) -> ReviewSession:
        sid = self._validate_session_id(session_id)
        user_id = source.user_id
        key = self._key(user_id, sid)
        root = source.root / "review-sessions"
        root.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
        path = root / f"{digest}.anki2"

        with self._guard:
            old = self._items.pop(key, None)
        if old:
            with old.lock:
                self._close(old)
        path.unlink(missing_ok=True)

        # sqlite3.backup() copia um snapshot consistente mesmo com a Collection
        # original aberta/WAL; shutil.copy2() aqui poderia perder páginas recentes.
        with sqlite3.connect(str(source.collection_path)) as src_db, sqlite3.connect(str(path)) as dst_db:
            src_db.backup(dst_db)

        col = Collection(str(path))
        try:
            all_ids = {int(cid) for cid in col.find_cards("")}
            allowed = all_ids if card_ids is None else {int(cid) for cid in card_ids if int(cid) in all_ids}
            remove = sorted(all_ids - allowed)
            if remove:
                col.remove_cards_and_orphaned_notes(remove)
            col.set_config("study_review_card_ids", None)
            col.set_config("study_review_scope_label", str(label or "Planejamento atual"))
            col.set_config("study_review_all_decks", int(deck_id) == 0)
            if deck_id:
                if not col.decks.get(DeckId(int(deck_id)), default=False):
                    raise HTTPException(404, "Baralho não encontrado no recorte.")
                col.decks.select(DeckId(int(deck_id)))
            elif bool((col.decks.get(col.decks.get_current_id()) or {}).get("dyn")):
                col.decks.select(DeckId(1))
            session = ReviewSession(
                user_id=user_id,
                session_id=sid,
                collection_path=path,
                col=col,
                card_ids=tuple(sorted(allowed)),
                label=str(label or "Planejamento atual"),
                deck_id=int(deck_id),
                version=uuid.uuid4().hex,
            )
        except BaseException:
            try:
                col.close()
            except Exception:
                pass
            path.unlink(missing_ok=True)
            raise

        with self._guard:
            self._items[key] = session
            self._items.move_to_end(key)
            self._evict_locked()
        return session

    def get(self, user_id: str, session_id: str) -> ReviewSession | None:
        key = self._key(user_id, self._validate_session_id(session_id))
        with self._guard:
            session = self._items.get(key)
            if session:
                session.last_used = time.monotonic()
                self._items.move_to_end(key)
            return session

    def close_all(self) -> None:
        with self._guard:
            sessions = list(self._items.values())
            self._items.clear()
        for session in sessions:
            with session.lock:
                self._close(session)


review_sessions = ReviewSessionPool()

# token -> (expira_em, usuario). Guardamos só o hash do token.
_token_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_token_guard = threading.Lock()


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cache_get(token: str) -> dict[str, Any] | None:
    if TOKEN_CACHE_SECONDS <= 0:
        return None
    key = _token_key(token)
    now = time.monotonic()
    with _token_guard:
        hit = _token_cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        if hit:
            _token_cache.pop(key, None)
    return None


def _cache_put(token: str, user: dict[str, Any]) -> None:
    if TOKEN_CACHE_SECONDS <= 0:
        return
    now = time.monotonic()
    with _token_guard:
        if len(_token_cache) > 5000:
            for k in [k for k, v in _token_cache.items() if v[0] <= now]:
                _token_cache.pop(k, None)
            if len(_token_cache) > 5000:
                _token_cache.clear()
        _token_cache[_token_key(token)] = (now + TOKEN_CACHE_SECONDS, user)


async def _upload_to_tempfile(upload: UploadFile, suffix: str, limit: int) -> str:
    """Grava o upload em disco em blocos, abortando ao passar do limite.

    Antes cada endpoint fazia `await upload.read(MAX+1)`: o arquivo inteiro
    (até 512 MB) ia para a RAM de uma vez, por requisição."""
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    total = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await upload.read(UPLOAD_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise HTTPException(413, "Arquivo excede o limite configurado.")
                out.write(chunk)
    except BaseException:
        _unlink_quiet(tmp)
        raise
    return tmp


async def _upload_bytes(upload: UploadFile, limit: int) -> bytes:
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(UPLOAD_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, "Arquivo excede o limite configurado.")
        parts.append(chunk)
    return b"".join(parts)


def _unlink_quiet(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _new_tempfile(suffix: str) -> str:
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return tmp


async def current_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sessão do Study ausente.")
    if not SUPABASE_ANON_KEY:
        raise HTTPException(503, "SUPABASE_ANON_KEY não configurada no backend.")
    token = authorization.split(" ", 1)[1].strip()
    cached = _cache_get(token)
    if cached is not None:
        return cached
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
    _cache_put(token, user)
    return user


def _validated_user_id(user: dict[str, Any]) -> str:
    uid = str(user["id"])
    if not uid or any(ch not in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_" for ch in uid):
        raise HTTPException(400, "Identificador de usuário inválido.")
    return uid


def uc_for(user: dict[str, Any]) -> UserCollection:
    return pool.get(_validated_user_id(user))


def cards_uc_for(user: dict[str, Any]) -> UserCollection:
    return cards_pool.get(_validated_user_id(user))


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


def queued_payload(col: Collection, queued=None) -> dict[str, Any]:
    if queued is None:
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


class CardsReviewScopeBody(SelectDeckBody):
    session_id: str
    card_ids: list[int] | None = None
    label: str = "Todos os planejamentos"


class CreateDeckBody(BaseModel):
    name: str


class NoteUpdateBody(BaseModel):
    fields: dict[str, str]
    tags: list[str] = []


class AnswerBody(BaseModel):
    session_id: str
    request_id: str = Field(min_length=8, max_length=220)
    card_id: int
    rating: int = Field(ge=1, le=4)
    milliseconds_taken: int = Field(default=0, ge=0, le=86_400_000)


class ScopedStatsBody(BaseModel):
    search: str = ""
    days: int = Field(default=365, ge=0, le=36500)
    card_ids: list[int] = []


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
    revision_file = Path(__file__).with_name("DEPLOY_REVISION")
    source_main = None
    if revision_file.is_file():
        for line in revision_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("source-main: "):
                source_main = line.removeprefix("source-main: ").strip() or None
                break
    return {
        "ok": True,
        "engine": "anki",
        "pinned_version": ANKI_VERSION,
        "runtime_version": ANKI_RUNTIME_VERSION,
        "build": "railpack",
        "source_rev": os.getenv("RAILWAY_GIT_COMMIT_SHA") or os.getenv("STUDY_BACKEND_SOURCE_REV"),
        "source_branch": os.getenv("RAILWAY_GIT_BRANCH"),
        "source_main": source_main,
    }


@app.get("/api/anki/status")
def status(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = uc_for(user)
    with item.lock:
        return {
            "connected": True,
            "engine": "Anki official",
            "pinned_version": ANKI_VERSION,
            "runtime_version": ANKI_RUNTIME_VERSION,
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


TYPE_ANSWER_PATTERN = re.compile(r"\[\[type:(.+?)\]\]")


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


def reviewer_payload(col: Collection, queued=None) -> dict[str, Any]:
    out = queued_payload(col, queued)
    if not out.get("finished"):
        card = col.get_card(int(out["card"]["id"]))
        ctx = type_answer_context(col, card)
        if ctx:
            safe = {k: v for k, v in ctx.items() if k != "expected"}
            out["card"]["type_answer"] = safe
    return out


def card_state_payload(col: Collection, card_id: int) -> dict[str, Any]:
    """Estado canônico de um card, serializado diretamente da API oficial."""
    card = col.get_card(card_id)
    memory = pb(card.memory_state) if card.memory_state is not None else None
    return {
        "id": int(card.id),
        "note_id": int(card.nid),
        "deck_id": int(card.did),
        "original_deck_id": int(card.odid),
        "template_idx": int(card.ord),
        "mtime_secs": int(card.mod),
        "type": int(card.type),
        "queue": int(card.queue),
        "due": int(card.due),
        "interval": int(card.ivl),
        "ease_factor": int(card.factor),
        "reps": int(card.reps),
        "lapses": int(card.lapses),
        "remaining_steps": int(card.left),
        "original_due": int(card.odue),
        "flag": int(card.user_flag()),
        "original_position": card.original_position,
        "custom_data": str(card.custom_data or ""),
        "memory_state": memory,
        "desired_retention": card.desired_retention,
        "decay": card.decay,
        "last_review_time": card.last_review_time,
        "question": card.question(),
        "answer": card.answer(),
        "stats": pb(col.card_stats_data(card.id)),
        "review_logs": [pb(entry) for entry in col.get_review_logs(card.id)],
    }


def cards_scoped_queue(col: Collection):
    """Intersect the official queue with Study identities; retain upstream order/states.

    No cards are moved, suspended or rescheduled to implement the UI scope.
    Daily limits remain those applied by Anki before this intersection.
    """
    queued = col.sched.get_queued_cards(fetch_limit=max(1, int(col.card_count())))
    ids = col.get_config("study_review_card_ids", None)
    if ids is not None:
        allowed = set(int(cid) for cid in ids)
        entries = [entry for entry in queued.cards if int(entry.card.id) in allowed]
        del queued.cards[:]
        queued.cards.extend(entries)
        queued.new_count = sum(int(entry.queue) == 0 for entry in entries)
        queued.learning_count = sum(int(entry.queue) == 1 for entry in entries)
        queued.review_count = sum(int(entry.queue) == 2 for entry in entries)
    return queued


def review_session_payload(session: ReviewSession) -> dict[str, Any]:
    out = cards_reviewer_payload(session.col)
    out["review_session"] = {
        "id": session.session_id,
        "version": session.version,
    }
    return out


def cards_reviewer_payload(col: Collection) -> dict[str, Any]:
    """Fila completa oficial para a UI Cards, sem reordenar nada no JavaScript."""
    # Uma Collection recém-migrada pode manter Default (id 1) selecionado,
    # vazio, enquanto todos os cards pertencem a baralhos importados.
    # Não altere seleções explícitas de outros decks nem Default com cards.
    if int(col.decks.get_current_id()) == 1 and bool(col.get_config("study_review_all_decks", True)):
        tree = col.sched.deck_due_tree()
        nodes = _deck_tree_flatten(tree)
        default = next((node for node in nodes if int(node["deck_id"]) == 1), None)
        # O Anki pode omitir Default da árvore quando ele está vazio.
        if default is None or int(default["total_including_children"]) == 0:
            candidates = [
                node for node in nodes
                if int(node["deck_id"]) not in (0, 1)
                and not node["filtered"]
                and int(node["total_including_children"]) > 0
            ]
            available = [
                node for node in candidates
                if int(node["new_count"]) + int(node["learn_count"]) + int(node["review_count"]) > 0
            ]
            target = next(iter(available or candidates), None)
            if target:
                col.decks.select(DeckId(int(target["deck_id"])))
    out = reviewer_payload(col, cards_scoped_queue(col))
    all_decks = bool(col.get_config("study_review_all_decks", True)) and not bool((col.decks.get(col.decks.get_current_id()) or {}).get("dyn"))
    if out.get("finished") and all_decks and not bool((col.decks.get(col.decks.get_current_id()) or {}).get("dyn")):
        current = int(col.decks.get_current_id())
        for node in _deck_tree_flatten(col.sched.deck_due_tree()):
            did = int(node["deck_id"])
            if did in (0, current) or node["filtered"]:
                continue
            if int(node["new_count"]) + int(node["learn_count"]) + int(node["review_count"]) <= 0:
                continue
            col.decks.select(DeckId(did))
            candidate = reviewer_payload(col, cards_scoped_queue(col))
            if not candidate.get("finished"):
                out = candidate
                break
        else:
            col.decks.select(DeckId(current))
    allowed = col.get_config("study_review_card_ids", None)
    allowed_set = None if allowed is None else set(int(cid) for cid in allowed)
    scope_ids = [int(cid) for cid in col.find_cards("") if allowed_set is None or int(cid) in allowed_set]
    scope_cards = [col.get_card(cid) for cid in scope_ids]
    scoped_decks = {int(card.did) for card in scope_cards}
    nodes = [node for node in _deck_tree_flatten(col.sched.deck_due_tree()) if int(node["deck_id"]) in scoped_decks]
    for node in nodes:
        name = col.decks.name(DeckId(int(node["deck_id"])))
        node["total_including_children"] = sum(
            col.decks.name(card.did) == name or col.decks.name(card.did).startswith(name + "::")
            for card in scope_cards
        )
    out["review_scope"] = {
        "all_decks": all_decks,
        "selected_deck_id": int(col.decks.get_current_id()),
        "decks": nodes,
        "total_cards": len(scope_ids),
        "label": str(col.get_config("study_review_scope_label", "Todos os planejamentos")),
        "inventory": {
            "new": sum(card.type == 0 for card in scope_cards),
            "learning": sum(card.type in (1, 3) for card in scope_cards),
            "review": sum(card.type == 2 for card in scope_cards),
        },
    }
    queued = cards_scoped_queue(col)
    out["queue_ids"] = [int(entry.card.id) for entry in queued.cards]
    out["counts"] = {
        "new": int(queued.new_count),
        "learning": int(queued.learning_count),
        "review": int(queued.review_count),
    }
    out["timing"] = {
        "today": int(col.sched.today),
        "collection_crt": int(col.crt),
    }
    return out


def note_state_payload(col: Collection, note_id: int) -> dict[str, Any]:
    note = col.get_note(note_id)
    nt = note.note_type() or {}
    return {
        "id": int(note.id),
        "guid": str(note.guid),
        "notetype_id": int(nt.get("id", 0) or 0),
        "notetype_name": str(nt.get("name", "")),
        "fields": dict(note.items()),
        "tags": list(note.tags),
        "card_ids": [int(x) for x in col.card_ids_of_note(note.id)],
    }


@app.post("/api/cards-official/notes")
def cards_official_add_note(
    body: AddNoteBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Cria a Note na coleção isolada dos Cards e devolve o conjunto de cards gerado pelo Anki."""
    item = cards_uc_for(user)
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
        state = note_state_payload(item.col, int(note.id))
        cards = [card_state_payload(item.col, int(cid)) for cid in state["card_ids"]]
        return {
            "ok": True,
            "changes": pb(changes) if changes is not None else {},
            "note": state,
            "cards": cards,
            "state": cards_collection_state_payload(item.col),
            "reviewer": cards_reviewer_payload(item.col),
        }


@app.put("/api/cards-official/note/{note_id}")
def cards_official_update_note(
    note_id: int,
    body: NoteUpdateBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Atualiza campos/tags pela Collection oficial; card generation segue update_note()."""
    item = cards_uc_for(user)
    with item.lock:
        note = item.col.get_note(note_id)
        valid = set(note.keys())
        for name, value in body.fields.items():
            if name in valid:
                note[name] = value
        note.tags = list(body.tags)
        changes = item.col.update_note(note)
        state = note_state_payload(item.col, int(note.id))
        cards = [card_state_payload(item.col, int(cid)) for cid in state["card_ids"]]
        return {
            "ok": True,
            "changes": pb(changes),
            "note": state,
            "cards": cards,
            "state": cards_collection_state_payload(item.col),
            "reviewer": cards_reviewer_payload(item.col),
        }


@app.delete("/api/cards-official/note/{note_id}")
def cards_official_delete_note(
    note_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Remove a Note e seus cards usando a operação transacional oficial."""
    item = cards_uc_for(user)
    with item.lock:
        item.col.get_note(note_id)
        changes = item.col.remove_notes([int(note_id)])
        return {
            "ok": True,
            "changes": pb(changes),
            "deleted_note_id": int(note_id),
            "state": cards_collection_state_payload(item.col),
            "reviewer": cards_reviewer_payload(item.col),
        }


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
            f'style="font-family:{html.escape(str(ctx["font"]), quote=True)};font-size:{int(ctx["size"])}px">'
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



# ---------------------------------------------------------------------------
# Cards do Study executados pelo backend OFICIAL do Anki
# ---------------------------------------------------------------------------

@app.get("/api/cards-official/status")
def cards_official_status(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return {
            "connected": True,
            "engine": "Anki official",
            "collection": "study-cards",
            "pinned_version": ANKI_VERSION,
            "runtime_version": ANKI_RUNTIME_VERSION,
            "cards": int(item.col.card_count()),
            "notes": int(item.col.note_count()),
            "current_deck_id": int(item.col.decks.get_current_id()),
        }


def _legacy_stock_kind(row: dict[str, Any]) -> int:
    raw = str(row.get("stock_kind") or row.get("kind") or "basic").strip().lower()
    aliases = {
        "basic": int(StockNotetypeKind.KIND_BASIC),
        "basic_reversed": int(StockNotetypeKind.KIND_BASIC_AND_REVERSED),
        "basic_optional_reversed": int(StockNotetypeKind.KIND_BASIC_OPTIONAL_REVERSED),
        "typing": int(StockNotetypeKind.KIND_BASIC_TYPING),
        "cloze": int(StockNotetypeKind.KIND_CLOZE),
        "image_occlusion": int(StockNotetypeKind.KIND_IMAGE_OCCLUSION),
    }
    # Espelhos anteriores não gravavam stockKind. O snapshot pode então
    # preencher "basic" usando apenas o primeiro card (sem o irmão reverso).
    # Reconheça os nomes stock exatos antes desse fallback; tipos customizados
    # não são inferidos por número de templates nem por nomes semelhantes.
    stock_names = {
        "basic (and reversed card)": "basic_reversed",
        "basic (optional reversed card)": "basic_optional_reversed",
        "basic (type in the answer)": "typing",
        "cloze": "cloze",
        "image occlusion": "image_occlusion",
    }
    if raw not in aliases or raw == "basic":
        raw = stock_names.get(str(row.get("name") or "").strip().lower(), raw)
    return aliases.get(raw, int(StockNotetypeKind.KIND_CLOZE) if row.get("kind") == "cloze" else int(StockNotetypeKind.KIND_BASIC))


def _apply_legacy_notetype_shape(col: Collection, nt: dict[str, Any], row: dict[str, Any]) -> None:
    """Copia a forma legada sem substituir um stock válido por um clone inválido."""
    fields = row.get("fields") if isinstance(row.get("fields"), list) else []
    templates = row.get("templates") if isinstance(row.get("templates"), list) else []
    legacy_field_count = len(fields)
    stock_notetype = from_json_bytes(
        col._backend.get_stock_notetype_legacy(_legacy_stock_kind(row))
    )
    stock_fields = [dict(field) for field in (stock_notetype.get("flds") or [])]
    stock_templates = [dict(template) for template in (stock_notetype.get("tmpls") or [])]

    # Espelhos antigos do Study podiam persistir Basic+Reverse com duas frentes
    # idênticas (ou vazias). O Anki 26.09.3 rejeita esse NoteType. Nesse caso,
    # quando o shape de campos é compatível com o stock, reconstruímos o par
    # campos+templates a partir de get_stock_notetype_legacy(). Assim os ords,
    # qfmt/afmt e identidade estrutural continuam sendo definidos pelo Anki.
    restore_stock_shape = False
    if templates and stock_templates and len(templates) == len(stock_templates):
        fronts = [str((template or {}).get("qfmt") or "").strip() for template in templates]
        nonempty = [front for front in fronts if front]
        invalid_fronts = any(not front for front in fronts) or len(set(nonempty)) != len(nonempty)
        compatible_fields = not fields or len(fields) >= len(stock_fields)
        restore_stock_shape = invalid_fronts and compatible_fields

    if restore_stock_shape:
        # Preserve os objetos já persistidos em nt: eles carregam ord/identidade
        # atribuídos pelo Anki. O stock cru devolvido pelo backend é uma fábrica
        # e não deve substituir esses dicionários por inteiro.
        if len(nt.get("flds") or []) != len(stock_fields) or len(nt.get("tmpls") or []) != len(stock_templates):
            restore_stock_shape = False
        else:
            for idx, stock_template in enumerate(stock_templates):
                target = nt["tmpls"][idx]
                for key in ("qfmt", "afmt"):
                    target[key] = str(stock_template.get(key) or "")
                legacy_template = templates[idx] if idx < len(templates) else {}
                if (legacy_template or {}).get("name"):
                    target["name"] = str(legacy_template["name"])
                for key in ("bqfmt", "bafmt", "did", "bfont", "bsize"):
                    if key in (legacy_template or {}):
                        target[key] = legacy_template[key]
            for idx, field_row in enumerate(fields):
                if idx >= len(nt["flds"]):
                    # Campos extras do espelho são dados do usuário, não
                    # motivo para descartar o reparo dos templates stock.
                    col.models.add_field(nt, col.models.new_field(str(
                        (field_row or {}).get("name") or f"Field {idx + 1}"
                    )))
                field = nt["flds"][idx]
                name = str((field_row or {}).get("name") or field.get("name") or f"Field {idx + 1}")
                if name != str(field.get("name") or ""):
                    col.models.rename_field(nt, field, name)
                for key in ("font", "size", "rtl", "sticky", "collapsed", "excludeFromSearch", "tag"):
                    if key in (field_row or {}):
                        field[key] = field_row[key]
            fields = []
            templates = []

    if fields:
        existing_fields = list(nt.get("flds") or [])
        nt["flds"] = []
        for idx, field_row in enumerate(fields):
            name = str((field_row or {}).get("name") or f"Field {idx + 1}")
            # ord/id são identidades do Anki, não apenas posições de UI.
            # Recriar todos os campos com ord=None faz o backend remover as
            # referências antigas e inserir o primeiro campo em ambas as frentes.
            field = dict(existing_fields[idx]) if idx < len(existing_fields) else col.models.new_field(name)
            field["name"] = name
            for key in ("font", "size", "rtl", "sticky", "collapsed", "excludeFromSearch", "tag"):
                if key in (field_row or {}):
                    field[key] = field_row[key]
            col.models.add_field(nt, field)
        # Primeiro deixe o Anki renomear os templates stock com os campos.
        # Só depois aplique qfmt/afmt legados, já escritos nos nomes finais.
        # Isso também evita renomear duas vezes um template com campos trocados.
        col.models.update_dict(nt, skip_checks=False)
        refreshed = col.models.get(int(nt["id"]))
        if refreshed:
            nt.update(refreshed)
    if templates:
        existing_templates = list(nt.get("tmpls") or [])
        nt["tmpls"] = []
        for idx, template_row in enumerate(templates):
            name = str((template_row or {}).get("name") or f"Card {idx + 1}")
            template = dict(existing_templates[idx]) if idx < len(existing_templates) else col.models.new_template(name)
            template["name"] = name
            template["qfmt"] = str((template_row or {}).get("qfmt") or "")
            template["afmt"] = str((template_row or {}).get("afmt") or "")
            for key in ("bqfmt", "bafmt", "did", "bfont", "bsize"):
                if key in (template_row or {}):
                    template[key] = template_row[key]
            col.models.add_template(nt, template)
    if "css" in row:
        nt["css"] = str(row.get("css") or "")
    if legacy_field_count:
        nt["sortf"] = max(0, min(legacy_field_count - 1, int(row.get("sortf") or 0)))

def _legacy_card_type_queue(row: dict[str, Any]) -> tuple[int, int]:
    if row.get("anki_type") is not None and row.get("anki_queue") is not None:
        return int(row["anki_type"]), int(row["anki_queue"])
    phase = str(row.get("phase") or "new").lower()
    if phase == "learning":
        ctype, queue = 1, 1
    elif phase == "review":
        ctype, queue = 2, 2
    elif phase == "relearning":
        ctype, queue = 3, 1
    else:
        ctype, queue = 0, 0
    if bool(row.get("suspenso")):
        queue = -1
    elif row.get("bury_kind") or row.get("buried_until"):
        queue = -3 if str(row.get("bury_kind") or "").lower() in ("user", "manual") else -2
    return ctype, queue


@contextmanager
def _collection_snapshot_guard(item: UserCollection, label: str):
    """Rollback físico para operações de migração que precisam ser atômicas."""
    backup = item.root / f"before-{label}-{int(time.time() * 1000)}.anki2"
    if not item.collection_path.exists():
        raise HTTPException(500, "Collection oficial não encontrada para snapshot.")
    item.col.close()
    shutil.copy2(item.collection_path, backup)
    item.col.reopen()
    try:
        yield
    except BaseException:
        try:
            item.col.close()
        except Exception:
            pass
        try:
            shutil.copy2(backup, item.collection_path)
        finally:
            item.col.reopen()
        raise
    finally:
        _unlink_quiet(str(backup))


@app.post("/api/cards-official/migrate/legacy")
def cards_official_migrate_legacy(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Migração única: transforma registros antigos em objetos da Collection oficial.

    Não agenda nem renderiza no código Study. NoteTypes/Notes/Decks/Cards são
    criados e persistidos pelos objetos oficiais do Anki; os campos de scheduling
    já existentes são apenas importados como estado inicial.
    """
    item = cards_uc_for(user)
    decks = payload.get("decks") if isinstance(payload.get("decks"), list) else []
    notetypes = payload.get("notetypes") if isinstance(payload.get("notetypes"), list) else []
    notes = payload.get("notes") if isinstance(payload.get("notes"), list) else []
    cards = payload.get("cards") if isinstance(payload.get("cards"), list) else []
    revlog = payload.get("revlog") if isinstance(payload.get("revlog"), list) else []
    with item.lock, _collection_snapshot_guard(item, "cards-legacy-migration"):
        if (item.col.card_count() or item.col.note_count()) and not payload.get("reconcile"):
            raise HTTPException(409, "A Collection oficial já contém dados; migração recusada.")

        deck_map: dict[str, int] = {}
        for row in decks:
            legacy_id = str((row or {}).get("id") or "")
            name = str((row or {}).get("name") or (row or {}).get("nome") or "").strip()
            if not name:
                continue
            existing = next((x for x in item.col.decks.all_names_and_ids() if str(x.name) == name), None)
            did = int(existing.id) if existing else int(item.col.decks.add_normal_deck_with_name(name).id)
            if legacy_id:
                deck_map[legacy_id] = did

        existing_guids = {str(item.col.get_note(nid).guid): int(nid) for nid in item.col.find_notes("")} if payload.get("reconcile") else {}
        existing_card_ids = set(int(cid) for cid in item.col.find_cards("")) if payload.get("reconcile") else set()
        if payload.get("reconcile"):
            needed_types = {str(row.get("notetype_id") or "") for row in notes if str(row.get("guid") or "") not in existing_guids}
            notetypes = [row for row in notetypes if str(row.get("id") or row.get("anki_id") or "") in needed_types]
        nt_map: dict[str, int] = {}
        claimed_nt_ids: set[int] = set()
        for row in notetypes:
            if not isinstance(row, dict):
                continue
            legacy_id = str(row.get("id") or row.get("anki_id") or "")
            name = str(row.get("name") or "Note Type").strip()
            stock = from_json_bytes(
                item.col._backend.get_stock_notetype_legacy(_legacy_stock_kind(row))
            )
            existing = item.col.models.by_name(name)
            existing_id = int(existing["id"]) if existing else 0
            if (
                existing
                and int(item.col.models.use_count(existing)) == 0
                and existing_id not in claimed_nt_ids
                # Um modelo vazio com o mesmo nome pode ser um clone legado
                # de outro stock. Reutilizá-lo desativa o reparo de templates
                # e mantém kind/identidades incompatíveis com o motor oficial.
                and int(existing.get("type", 0)) == int(stock.get("type", 0))
                and len(existing.get("flds") or []) == len(stock.get("flds") or [])
                and len(existing.get("tmpls") or []) == len(stock.get("tmpls") or [])
            ):
                nt = existing
            else:
                raw = stock
                raw["id"] = 0
                raw["name"] = name
                changes = item.col.models.add_dict(raw)
                nt = item.col.models.get(int(changes.id))
            if not nt:
                raise HTTPException(500, f"Falha ao criar NoteType {name}.")
            try:
                _apply_legacy_notetype_shape(item.col, nt, row)
                item.col.models.update_dict(nt, skip_checks=False)
            except CardTypeError as exc:
                # Erro de validação do próprio Anki deve atravessar a API como
                # resposta estruturada (com CORS), em vez de virar um 500 que o
                # navegador reduz a "Failed to fetch". O snapshot guard restaura
                # a Collection antes da resposta.
                raise HTTPException(
                    422,
                    f"NoteType legado incompatível com o Anki oficial ({name}): {exc}",
                ) from exc
            claimed_nt_ids.add(int(nt["id"]))
            if legacy_id:
                nt_map[legacy_id] = int(nt["id"])

        cards_by_note: dict[str, list[dict[str, Any]]] = {}
        for card_row in cards:
            if not isinstance(card_row, dict):
                continue
            cards_by_note.setdefault(str(card_row.get("note_id") or card_row.get("anki_note_id") or card_row.get("id") or ""), []).append(card_row)

        note_map: dict[str, int] = {}
        card_map: dict[str, int] = {}
        for row in notes:
            if not isinstance(row, dict):
                continue
            legacy_nid = str(row.get("id") or row.get("anki_id") or "")
            existing_nid = existing_guids.get(str(row.get("guid") or ""))
            if existing_nid:
                note_map[legacy_nid] = existing_nid
                by_ord = {int(item.col.get_card(cid).ord): int(cid) for cid in item.col.card_ids_of_note(existing_nid)}
                for old in cards_by_note.get(legacy_nid, []):
                    ordinal = int(old.get("template_idx", 0))
                    if ordinal not in by_ord:
                        raise HTTPException(422, "Nota existente sem o ordinal legado; reconciliação interrompida para preservar revisões.")
                    card_map[str(old.get("id") or old.get("anki_id") or "")] = by_ord[ordinal]
                continue
            ntid = nt_map.get(str(row.get("notetype_id") or ""))
            nt = item.col.models.get(ntid) if ntid else item.col.models.current()
            if not nt:
                raise HTTPException(400, f"NoteType legado não localizado para nota {legacy_nid}.")
            note = item.col.new_note(nt)
            legacy_guid = str(row.get("guid") or "").strip()
            if legacy_guid:
                note.guid = legacy_guid
            fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
            for key in note.keys():
                note[key] = str(fields.get(key, ""))
            note.tags = [str(x) for x in (row.get("tags") or []) if str(x)]
            related = cards_by_note.get(legacy_nid, [])
            legacy_deck = str((related[0] if related else {}).get("deck_id") or "")
            did = DeckId(deck_map.get(legacy_deck, 1))
            item.col.add_note(note, did)
            note_map[legacy_nid] = int(note.id)

            official_cards = [item.col.get_card(cid) for cid in item.col.card_ids_of_note(note.id)]
            by_ord = {int(card.ord): card for card in official_cards}
            for idx, old in enumerate(related):
                ord_ = int(old.get("template_idx") or old.get("anki_template_ord") or old.get("ord") or 0)
                card = by_ord.get(ord_)
                if not card:
                    raise HTTPException(422, f"Ordinal legado {ord_} sem card oficial; migração interrompida.")
                legacy_cid = str(old.get("id") or old.get("anki_id") or "")
                did2 = deck_map.get(str(old.get("deck_id") or ""), int(card.did))
                ctype, queue = _legacy_card_type_queue(old)
                card.did = DeckId(did2)
                card.type = type(card.type)(ctype)
                card.queue = type(card.queue)(int(old.get("anki_queue")) if old.get("anki_queue") is not None else queue)
                if old.get("anki_due") is not None:
                    card.due = int(old.get("anki_due") or 0)
                elif ctype == 0:
                    card.due = max(1, int(old.get("new_position") or old.get("posicao_nova") or card.due or 1))
                elif ctype in (1, 3):
                    if old.get("due_ts"):
                        card.due = max(0, int(float(old.get("due_ts") or 0) / 1000))
                elif ctype == 2 and old.get("due_offset_days") is not None:
                    card.due = max(0, int(item.col.sched.today) + int(old.get("due_offset_days") or 0))
                card.ivl = max(0, int(old.get("interval") or old.get("intervalo") or 0))
                ease = float(old.get("ease") or 0)
                card.factor = max(0, int(old.get("ease_factor") or (ease * 1000 if 0 < ease < 10 else ease)))
                card.reps = max(0, int(old.get("reps") or 0))
                card.lapses = max(0, int(old.get("lapses") or 0))
                if old.get("remaining_steps") is not None or old.get("anki_remaining_steps") is not None:
                    card.left = max(0, int(old.get("remaining_steps") or old.get("anki_remaining_steps") or 0))
                if old.get("original_due") is not None or old.get("anki_original_due") is not None:
                    card.odue = max(0, int(old.get("original_due") or old.get("anki_original_due") or 0))
                elif old.get("original_due_ts"):
                    card.odue = max(0, int(float(old.get("original_due_ts") or 0) / 1000))
                elif old.get("original_due_offset_days") is not None:
                    card.odue = max(0, int(item.col.sched.today) + int(old.get("original_due_offset_days") or 0))
                odid = deck_map.get(str(old.get("original_deck_id") or ""), 0)
                card.odid = DeckId(odid)
                card.flags = max(0, min(7, int(old.get("flag") or 0)))
                if old.get("s") is not None and old.get("d") is not None:
                    s = float(old.get("s") or 0)
                    d = float(old.get("d") or 0)
                    if s > 0 and d > 0:
                        card.memory_state = cards_pb2.FsrsMemoryState(stability=s, difficulty=d)
                # custom_data pertence ao contrato oficial do Anki/Card State Customizer.
                # Metadados de matéria/assunto/banca/plano ficam na casca Study,
                # ligada ao card pelo card_map devolvido abaixo.
                item.col.update_card(card)
                if legacy_cid:
                    card_map[legacy_cid] = int(card.id)

        # Só linhas que já carregam a semântica canônica do revlog Anki são
        # importadas; linhas antigas ambíguas não são reinterpretadas.
        rev_rows: list[tuple[int, int, int, int, int, int, int, int, int]] = []
        seen_rev_ids: set[int] = set()
        for row in revlog:
            if not isinstance(row, dict) or int(row.get("anki_ivl_semantica") or 0) != 2:
                continue
            cid = card_map.get(str(row.get("card_id") or row.get("anki_card_id") or ""))
            if not cid or cid in existing_card_ids:
                continue
            rid = max(1, int(row.get("ts") or int(time.time() * 1000)))
            while rid in seen_rev_ids:
                rid += 1
            seen_rev_ids.add(rid)
            raw_kind = row.get("anki_review_kind")
            kind = int(raw_kind) if raw_kind is not None else 1
            rev_rows.append((
                rid, cid, -1, max(0, min(4, int(row.get("grade") or 0))),
                int(row.get("anki_interval") or 0), int(row.get("anki_last_interval") or 0),
                max(0, int(row.get("ease_factor") or 0)), max(0, int(row.get("time") or 0)), kind,
            ))
        if rev_rows:
            item.col.db.executemany(
                "insert or ignore into revlog (id,cid,usn,ease,ivl,lastIvl,factor,time,type) values (?,?,?,?,?,?,?,?,?)",
                rev_rows,
            )

        if len(note_map) != len(notes):
            raise HTTPException(422, f"Migração incompleta: {len(note_map)}/{len(notes)} Notes foram materializadas.")
        if len(card_map) != len(cards) or len(set(card_map.values())) != len(cards):
            raise HTTPException(
                422,
                f"Migração incompleta: {len(card_map)}/{len(cards)} Cards foram mapeados de forma única.",
            )

        # Scheduler v3 do Anki 26.09.3 invalida/reconstrói as filas
        # automaticamente após operações da Collection. A antiga API
        # clear_study_queues() não existe no pylib atual e não deve ser emulada.
        return {
            "ok": True,
            "migrated": {"decks": len(deck_map), "notetypes": len(nt_map), "notes": len(note_map), "cards": len(card_map), "revlog": len(rev_rows)},
            "deck_map": deck_map,
            "notetype_map": nt_map,
            "card_map": card_map,
            "note_map": note_map,
            "state": cards_collection_full_state_payload(item.col),
        }


@app.post("/api/cards-official/bootstrap")
async def cards_official_bootstrap(
    package: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Substitui a coleção isolada dos Cards por um .colpkg e deixa o Anki normalizá-la."""
    name = package.filename or "study-cards.colpkg"
    if not name.lower().endswith(".colpkg"):
        raise HTTPException(400, "O bootstrap dos Cards exige um .colpkg.")
    item = cards_uc_for(user)
    tmp = await _upload_to_tempfile(package, ".colpkg", MAX_IMPORT_BYTES)
    try:
        with item.lock:
            backup = item.root / f"before-cards-bootstrap-{int(time.time())}.anki2"
            if item.collection_path.exists():
                item.col.close()
                shutil.copy2(item.collection_path, backup)
                item.col.reopen()
            backend = item.col._backend
            item.col.close()
            try:
                media_folder, media_db = media_paths_from_col_path(str(item.collection_path))
                backend.import_collection_package(
                    import_export_pb2.ImportCollectionPackageRequest(
                        col_path=str(item.collection_path),
                        backup_path=tmp,
                        media_folder=media_folder,
                        media_db=media_db,
                    )
                )
            except BaseException:
                if backup.exists():
                    try:
                        shutil.copy2(backup, item.collection_path)
                    except OSError:
                        pass
                raise
            finally:
                item.col.reopen()
            return {
                "ok": True,
                "engine": "Anki official",
                "runtime_version": ANKI_RUNTIME_VERSION,
                "cards": int(item.col.card_count()),
                "notes": int(item.col.note_count()),
                "reviewer": cards_reviewer_payload(item.col),
            }
    finally:
        _unlink_quiet(tmp)


@app.post("/api/cards-official/reviewer/scope")
def cards_official_reviewer_scope(
    body: CardsReviewScopeBody, user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        did = int(body.deck_id)
        if did and not item.col.decks.get(DeckId(did), default=False):
            raise HTTPException(404, "Baralho não encontrado.")
        known = {int(cid) for cid in item.col.find_cards("")}
        ids = None if body.card_ids is None else sorted({int(cid) for cid in body.card_ids if int(cid) in known})
        session = review_sessions.create(
            item,
            body.session_id,
            ids,
            getattr(body, "label", "Todos os planejamentos"),
            did,
        )
        with session.lock:
            return review_session_payload(session)


@app.get("/api/cards-official/reviewer/next")
def cards_official_reviewer_next(
    session_id: str = Query(..., min_length=8, max_length=160),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        session = review_sessions.get(item.user_id, session_id)
        if not session:
            raise HTTPException(409, "Sessão de revisão expirada; reconstrua o recorte.")
        with session.lock:
            return review_session_payload(session)


@app.get("/api/cards-official/card/{card_id}/state")
def cards_official_card_state(
    card_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return card_state_payload(item.col, card_id)


@app.post("/api/cards-official/reviewer/type-answer/{card_id}")
def cards_official_reviewer_type_answer(
    card_id: int,
    body: TypeAnswerBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        card = item.col.get_card(card_id)
        ctx = type_answer_context(item.col, card)
        if not ctx or not ctx.get("enabled"):
            return {"enabled": False, "answer_html": TYPE_ANSWER_PATTERN.sub("", card.answer())}
        comparison = item.col.compare_answer(str(ctx["expected"]), body.provided, bool(ctx["combining"]))
        answer_html = card.answer()
        had_separator = '<hr id=answer>' in answer_html
        stripped = answer_html.replace('<hr id=answer>', '')
        replacement = (
            f'<div class="anki-type-answer-comparison" '
            f'style="font-family:{html.escape(str(ctx["font"]), quote=True)};font-size:{int(ctx["size"])}px">'
            f'{comparison}</div>'
        )
        if had_separator:
            replacement = '<hr id=answer>' + replacement
        if TYPE_ANSWER_PATTERN.search(stripped):
            answer_html = TYPE_ANSWER_PATTERN.sub(replacement, stripped, count=1)
        return {"enabled": True, "answer_html": answer_html, "comparison": comparison}


def _answer_receipts(col: Collection) -> dict[str, Any]:
    value = col.get_config("study_answer_receipts", {})
    return value if isinstance(value, dict) else {}


def _remember_answer_receipt(col: Collection, request_id: str, card_id: int, rating: int) -> None:
    receipts = _answer_receipts(col)
    receipts[str(request_id)] = {
        "card_id": int(card_id),
        "rating": int(rating),
        "saved_at": int(time.time()),
    }
    if len(receipts) > 64:
        ordered = sorted(receipts.items(), key=lambda kv: int((kv[1] or {}).get("saved_at", 0)))
        receipts = dict(ordered[-64:])
    # set_config() não cria undo entry por padrão, então o recibo não desloca
    # a operação acadêmica no histórico oficial.
    col.set_config("study_answer_receipts", receipts)


@app.post("/api/cards-official/reviewer/answer")
def cards_official_reviewer_answer(
    body: AnswerBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        prior = _answer_receipts(item.col).get(str(body.request_id))
        if prior:
            if int(prior.get("card_id", 0)) != int(body.card_id) or int(prior.get("rating", 0)) != int(body.rating):
                raise HTTPException(409, "Esta tentativa já foi aplicada com outro card ou resposta.")
            session = review_sessions.get(item.user_id, body.session_id)
            reviewer = None
            if session:
                with session.lock:
                    reviewer = review_session_payload(session)
            return {
                "ok": True,
                "idempotent": True,
                "answered": card_state_payload(item.col, int(body.card_id)),
                "reviewer": reviewer,
                "undo_status": pb(item.col.undo_status()),
            }

        session = review_sessions.get(item.user_id, body.session_id)
        if not session:
            raise HTTPException(409, "Sessão de revisão expirada; reconstrua o recorte.")
        with session.lock:
            queued = session.col.sched.get_queued_cards(
                fetch_limit=max(1, int(session.col.card_count()))
            )
            if not queued.cards:
                raise HTTPException(409, "A fila oficial dos Cards não possui card atual.")
            q = queued.cards[0]
            if int(q.card.id) != int(body.card_id):
                raise HTTPException(409, "O card atual desta sessão mudou; recarregue.")

            live = item.col.get_card(int(q.card.id))
            snap = session.col.get_card(int(q.card.id))
            signature = lambda c: (
                int(c.type), int(c.queue), int(c.due), int(c.ivl), int(c.reps),
                int(c.lapses), int(c.did), int(c.odid), int(c.left),
            )
            if signature(live) != signature(snap):
                raise HTTPException(409, "O card mudou em outro aparelho; reconstrua a sessão antes de responder.")

            live.start_timer()
            rating = {
                1: CardAnswer.AGAIN,
                2: CardAnswer.HARD,
                3: CardAnswer.GOOD,
                4: CardAnswer.EASY,
            }[body.rating]
            answer = item.col.sched.build_answer(card=live, states=q.states, rating=rating)
            answer.milliseconds_taken = body.milliseconds_taken
            item.col.sched.answer_card(answer)

            # O snapshot avança com os MESMOS estados oficiais escolhidos para a
            # resposta real. Ele nunca é fonte persistente de scheduling.
            snap.start_timer()
            session_answer = session.col.sched.build_answer(card=snap, states=q.states, rating=rating)
            session_answer.answered_at_millis = answer.answered_at_millis
            session_answer.milliseconds_taken = body.milliseconds_taken
            try:
                session.col.sched.answer_card(session_answer)
            except Exception:
                # Se o snapshot falhar, a resposta real já é canônica. Refaz a
                # sessão a partir dela em vez de tentar compensar o scheduler.
                replacement = review_sessions.create(
                    item,
                    session.session_id,
                    list(session.card_ids),
                    session.label,
                    session.deck_id,
                )
                session = replacement

            _remember_answer_receipt(item.col, body.request_id, body.card_id, body.rating)
            reviewer = review_session_payload(session)
            return {
                "ok": True,
                "idempotent": False,
                "answered": card_state_payload(item.col, int(body.card_id)),
                "reviewer": reviewer,
                "undo_status": pb(item.col.undo_status()),
            }


@app.get("/api/cards-official/browser/ids")
def cards_official_browser_ids(
    mode: str = Query(default="cards"),
    q: str = Query(default=""),
    sort_key: str = Query(default=""),
    reverse: bool = Query(default=False),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """A gramática e a ordenação são 100% do Collection.find_* oficial."""
    item = cards_uc_for(user)
    mode = mode.strip().lower()
    if mode not in {"cards", "notes"}:
        raise HTTPException(400, "Modo do navegador deve ser cards ou notes.")
    with item.lock:
        order: Any = True
        if sort_key:
            order = item.col.get_browser_column(sort_key)
            if order is None:
                raise HTTPException(400, f"Coluna de ordenação desconhecida: {sort_key}")
        if mode == "notes":
            ids = [int(x) for x in item.col.find_notes(q, order=order, reverse=reverse)]
        else:
            ids = [int(x) for x in item.col.find_cards(q, order=order, reverse=reverse)]
        return {"mode": mode, "query": q, "sort_key": sort_key, "reverse": reverse, "total": len(ids), "ids": ids}



@app.post("/api/cards-official/browser/rows")
def cards_official_browser_rows(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Dados visíveis do Browser renderizados/calculados exclusivamente pelo Anki."""
    item = cards_uc_for(user)
    mode = str(payload.get("mode", "cards")).strip().lower()
    ids = [int(x) for x in payload.get("ids", [])]
    if mode not in {"cards", "notes"}:
        raise HTTPException(400, "Modo do navegador deve ser cards ou notes.")
    if len(ids) > 1000:
        raise HTTPException(400, "Máximo de 1000 linhas por lote.")
    with item.lock:
        rows: list[dict[str, Any]] = []
        if mode == "cards":
            for cid in ids:
                card = item.col.get_card(cid)
                note = card.note()
                stats = item.col.card_stats_data(card.id)
                rows.append({
                    "id": int(card.id),
                    "note_id": int(note.id),
                    "question": card.question(browser=True),
                    "answer": card.answer(),
                    "stats": pb(stats),
                    "fields": dict(note.items()),
                    "tags": list(note.tags),
                    "flag": int(card.user_flag()),
                    "queue": int(card.queue),
                    "type": int(card.type),
                    "due": int(card.due),
                    "original_deck_id": int(card.odid),
                    "suspended": int(card.queue) == -1,
                })
        else:
            for nid in ids:
                note = item.col.get_note(nid)
                card_ids = [int(x) for x in item.col.card_ids_of_note(note.id)]
                cards = []
                for cid in card_ids:
                    card = item.col.get_card(cid)
                    cards.append({
                        "id": int(card.id),
                        "question": card.question(browser=True),
                        "answer": card.answer(),
                        "stats": pb(item.col.card_stats_data(card.id)),
                        "flag": int(card.user_flag()),
                        "queue": int(card.queue),
                        "type": int(card.type),
                        "due": int(card.due),
                        "original_deck_id": int(card.odid),
                        "suspended": int(card.queue) == -1,
                    })
                rows.append({
                    "id": int(note.id),
                    "fields": dict(note.items()),
                    "tags": list(note.tags),
                    "cards": cards,
                })
        return {"mode": mode, "rows": rows}


@app.get("/api/cards-official/browser/facets")
def cards_official_browser_facets(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
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
            "columns": [pb(column) for column in item.col.all_browser_columns()],
            "active_cards": list(item.col.load_browser_card_columns()),
            "active_notes": list(item.col.load_browser_note_columns()),
        }


@app.get("/api/cards-official/notetypes/full")
def cards_official_notetypes_full(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return {
            "notetypes": [
                {"notetype": nt, "use_count": int(item.col.models.use_count(nt))}
                for nt in item.col.models.all()
            ]
        }


@app.post("/api/cards-official/notetypes/stock")
def cards_official_create_stock_notetype(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Cria o tipo a partir do stock notetype da própria versão fixada do Anki."""
    item = cards_uc_for(user)
    kind = int(payload.get("kind", 0))
    name = str(payload.get("name", "")).strip()
    valid_kinds = {
        int(StockNotetypeKind.KIND_BASIC),
        int(StockNotetypeKind.KIND_BASIC_AND_REVERSED),
        int(StockNotetypeKind.KIND_BASIC_OPTIONAL_REVERSED),
        int(StockNotetypeKind.KIND_BASIC_TYPING),
        int(StockNotetypeKind.KIND_CLOZE),
        int(StockNotetypeKind.KIND_IMAGE_OCCLUSION),
    }
    if kind not in valid_kinds:
        raise HTTPException(400, "Stock NoteType inválido.")
    with item.lock:
        raw = from_json_bytes(item.col._backend.get_stock_notetype_legacy(kind))
        raw["id"] = 0
        if name:
            raw["name"] = name
        changes = item.col.models.add_dict(raw)
        ntid = int(changes.id)
        created = item.col.models.get(ntid)
        return {
            "ok": True,
            "changes": pb(changes),
            "notetype": created,
            "use_count": int(item.col.models.use_count(created)),
            "state": cards_collection_state_payload(item.col),
        }


@app.post("/api/cards-official/notetypes/{notetype_id}/copy")
def cards_official_copy_notetype(
    notetype_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        source = item.col.models.get(notetype_id)
        if not source:
            raise HTTPException(404, "Tipo de nota não encontrado.")
        cloned = item.col.models.copy(source, add=False)
        name = str(payload.get("name", "")).strip()
        if name:
            cloned["name"] = name
        changes = item.col.models.add_dict(cloned)
        ntid = int(changes.id)
        created = item.col.models.get(ntid)
        return {
            "ok": True,
            "changes": pb(changes),
            "notetype": created,
            "use_count": int(item.col.models.use_count(created)),
            "state": cards_collection_state_payload(item.col),
        }


@app.put("/api/cards-official/notetypes/{notetype_id}")
def cards_official_update_notetype(
    notetype_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Converte controles da casca Study em operações oficiais do NoteTypeManager."""
    item = cards_uc_for(user)
    edit = payload.get("edit")
    if not isinstance(edit, dict):
        raise HTTPException(400, "Edição de NoteType ausente.")

    desired_fields = edit.get("fields")
    desired_templates = edit.get("templates")
    if not isinstance(desired_fields, list) or not isinstance(desired_templates, list):
        raise HTTPException(400, "Campos/templates inválidos.")

    with item.lock:
        nt = item.col.models.get(notetype_id)
        if not nt:
            raise HTTPException(404, "Tipo de nota não encontrado.")
        note_ids = [int(x) for x in item.col.models.nids(notetype_id)]

        # Os objetos-base vêm da Collection oficial. O Study só informa qual
        # controle visual corresponde a qual campo/template preexistente.
        original_fields = {str(field.get("name", "")): field for field in nt["flds"]}
        original_templates = {
            int(template.get("ord", idx) if template.get("ord") is not None else idx): template
            for idx, template in enumerate(nt["tmpls"])
        }

        field_rows = []
        referenced_fields: set[str] = set()
        for row in desired_fields:
            if not isinstance(row, dict):
                raise HTTPException(400, "Campo inválido.")
            name = str(row.get("name", "")).strip()
            if not name:
                raise HTTPException(400, "Nome de campo vazio.")
            source_name = row.get("source_name")
            field = original_fields.get(str(source_name)) if source_name is not None else None
            if field is None:
                field = item.col.models.new_field(name)
                item.col.models.add_field(nt, field)
            else:
                referenced_fields.add(str(source_name))
                if str(field.get("name", "")) != name:
                    item.col.models.rename_field(nt, field, name)
            field_rows.append(field)

        for source_name, field in original_fields.items():
            if source_name not in referenced_fields:
                item.col.models.remove_field(nt, field)
        for idx, field in enumerate(field_rows):
            item.col.models.reposition_field(nt, field, idx)

        template_rows = []
        referenced_templates: set[int] = set()
        for row in desired_templates:
            if not isinstance(row, dict):
                raise HTTPException(400, "Template inválido.")
            name = str(row.get("name", "")).strip()
            if not name:
                raise HTTPException(400, "Nome de template vazio.")
            source_ord = row.get("source_ord")
            template = None
            if source_ord is not None:
                try:
                    source_ord_int = int(source_ord)
                except (TypeError, ValueError) as exc:
                    raise HTTPException(400, "Ordinal de template inválido.") from exc
                template = original_templates.get(source_ord_int)
                if template is not None:
                    referenced_templates.add(source_ord_int)
            if template is None:
                template = item.col.models.new_template(name)
                item.col.models.add_template(nt, template)
            template["name"] = name
            template["qfmt"] = str(row.get("qfmt", ""))
            template["afmt"] = str(row.get("afmt", ""))
            template_rows.append(template)

        for source_ord, template in original_templates.items():
            if source_ord not in referenced_templates:
                item.col.models.remove_template(nt, template)
        for idx, template in enumerate(template_rows):
            item.col.models.reposition_template(nt, template, idx)

        nt["name"] = str(edit.get("name", nt.get("name", ""))).strip() or nt["name"]
        nt["css"] = str(edit.get("css", nt.get("css", "")))
        changes = item.col.models.update_dict(nt, skip_checks=False)
        updated = item.col.models.get(notetype_id)

        notes = []
        cards = []
        for nid in note_ids:
            try:
                ns = note_state_payload(item.col, nid)
            except Exception:
                continue
            notes.append(ns)
            for cid in ns["card_ids"]:
                try:
                    cards.append(card_state_payload(item.col, int(cid)))
                except Exception:
                    pass
        return {
            "ok": True,
            "changes": pb(changes),
            "notetype": updated,
            "use_count": int(item.col.models.use_count(updated)),
            "notes": notes,
            "cards": cards,
            "state": cards_collection_state_payload(item.col),
        }


@app.delete("/api/cards-official/notetypes/{notetype_id}")
def cards_official_delete_notetype(
    notetype_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        nt = item.col.models.get(notetype_id)
        if not nt:
            raise HTTPException(404, "Tipo de nota não encontrado.")
        used = int(item.col.models.use_count(nt))
        if used:
            raise HTTPException(409, f"Tipo de nota ainda é usado por {used} nota(s).")
        changes = item.col.models.remove(notetype_id)
        return {
            "ok": True,
            "changes": pb(changes),
            "deleted_notetype_id": int(notetype_id),
            "state": cards_collection_state_payload(item.col),
        }


@app.post("/api/cards-official/notetypes/{notetype_id}/restore-stock")
def cards_official_restore_notetype(
    notetype_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    force = payload.get("force_kind")
    force_kind = None if force is None else int(force)
    with item.lock:
        if not item.col.models.get(notetype_id):
            raise HTTPException(404, "Tipo de nota não encontrado.")
        changes = item.col.models.restore_notetype_to_stock(notetype_id, force_kind)
        updated = item.col.models.get(notetype_id)
        note_ids = [int(x) for x in item.col.models.nids(notetype_id)]
        notes = [note_state_payload(item.col, nid) for nid in note_ids]
        cards = [
            card_state_payload(item.col, int(cid))
            for ns in notes
            for cid in ns["card_ids"]
        ]
        return {
            "ok": True,
            "changes": pb(changes),
            "notetype": updated,
            "use_count": int(item.col.models.use_count(updated)),
            "notes": notes,
            "cards": cards,
            "state": cards_collection_state_payload(item.col),
        }


@app.get("/api/cards-official/notetypes/change-info")
def cards_official_change_notetype_info(
    old_notetype_id: int = Query(...),
    new_notetype_id: int = Query(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(
            item.col.models.change_notetype_info(
                old_notetype_id=old_notetype_id,
                new_notetype_id=new_notetype_id,
            )
        )


@app.post("/api/cards-official/notetypes/change")
def cards_official_change_notetype(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    request = notetypes_pb2.ChangeNotetypeRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise HTTPException(400, f"Mudança de tipo inválida: {exc}") from exc
    note_ids = [int(x) for x in request.note_ids]
    with item.lock:
        changes = item.col.models.change_notetype_of_notes(request)
        notes = []
        cards = []
        for nid in note_ids:
            try:
                note_state = note_state_payload(item.col, nid)
            except Exception:
                continue
            notes.append(note_state)
            for cid in note_state["card_ids"]:
                try:
                    cards.append(card_state_payload(item.col, int(cid)))
                except Exception:
                    pass
        return {
            "ok": True,
            "changes": pb(changes),
            "notes": notes,
            "cards": cards,
            "reviewer": cards_reviewer_payload(item.col),
        }


@app.post("/api/cards-official/browser/bulk")
def cards_official_browser_bulk(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    action = str(payload.get("action", "")).strip()
    card_ids = [int(x) for x in payload.get("card_ids", [])]
    note_ids = [int(x) for x in payload.get("note_ids", [])]
    with item.lock:
        if not card_ids and note_ids:
            for nid in note_ids:
                card_ids.extend(int(x) for x in item.col.card_ids_of_note(nid))
        card_ids = list(dict.fromkeys(card_ids))
        note_ids = list(dict.fromkeys(note_ids))
        changes: dict[str, Any] | None = None

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
        elif action == "mark":
            marked = bool(payload.get("marked", True))
            for nid in note_ids:
                note = item.col.get_note(nid)
                tags = [tag for tag in note.tags if tag != "marked"]
                if marked:
                    tags.append("marked")
                note.tags = tags
                item.col.update_note(note)
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
            changes = pb(out)
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
            changes = pb(item.col.models.change_notetype_of_notes(request))
        else:
            raise HTTPException(400, f"Ação em massa não suportada: {action}")

        card_states = []
        if action != "delete_notes":
            for cid in card_ids:
                try:
                    card_states.append(card_state_payload(item.col, cid))
                except Exception:
                    pass
        note_states = []
        if action != "delete_notes":
            for nid in note_ids:
                try:
                    note_states.append(note_state_payload(item.col, nid))
                except Exception:
                    pass
        return {
            "ok": True,
            "changes": changes,
            "cards": card_states,
            "notes": note_states,
            "deleted_note_ids": note_ids if action == "delete_notes" else [],
            "reviewer": cards_reviewer_payload(item.col),
        }


@app.post("/api/cards-official/undo")
def cards_official_undo(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        out = pb(item.col.undo())
        return {"ok": True, "changes": out, "reviewer": cards_reviewer_payload(item.col)}


@app.post("/api/cards-official/redo")
def cards_official_redo(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        out = pb(item.col.redo())
        return {"ok": True, "changes": out, "reviewer": cards_reviewer_payload(item.col)}


@app.get("/api/cards-official/history/status")
def cards_official_history_status(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.undo_status())


@app.post("/api/cards-official/history/undo")
def cards_official_history_undo(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        out = item.col.undo()
        return {
            "ok": True,
            "changes": pb(out),
            "state": cards_collection_full_state_payload(item.col),
            "status": pb(item.col.undo_status()),
        }


@app.post("/api/cards-official/history/redo")
def cards_official_history_redo(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        out = item.col.redo()
        return {
            "ok": True,
            "changes": pb(out),
            "state": cards_collection_full_state_payload(item.col),
            "status": pb(item.col.undo_status()),
        }


@app.get("/api/cards-official/browser/duplicates")
def cards_official_browser_duplicates(
    field: str = Query(..., min_length=1),
    search: str = Query(default=""),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        groups = item.col.find_dupes(field, search)
        return {
            "field": field,
            "search": search,
            "groups": [
                {"value": value, "note_ids": [int(nid) for nid in nids]}
                for value, nids in groups
            ],
        }


@app.get("/api/cards-official/card-info/{card_id}")
def cards_official_card_info(
    card_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Card Info oficial: dados produzidos por Collection.card_stats_data()."""
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.card_stats_data(int(card_id)))


@app.post("/api/cards-official/cards/action")
def cards_official_card_action(
    body: CardActionBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
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
            seen: set[int] = set()
            for cid in ids:
                note = item.col.get_card(cid).note()
                if int(note.id) in seen:
                    continue
                seen.add(int(note.id))
                if "marked" in note.tags:
                    note.tags = [tag for tag in note.tags if tag != "marked"]
                else:
                    note.tags.append("marked")
                item.col.update_note(note)
        elif body.action == "delete_notes":
            item.col.remove_notes_by_card(ids)
        else:
            raise HTTPException(400, f"Ação não suportada: {body.action}")
        states = [] if body.action == "delete_notes" else [card_state_payload(item.col, cid) for cid in ids]
        notes = [note_state_payload(item.col, nid) for nid in sorted(seen)] if body.action == "mark" else []
        return {"ok": True, "cards": states, "notes": notes, "reviewer": cards_reviewer_payload(item.col)}


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
            # Uma nota com vários cards selecionados era alternada uma vez por
            # card: dois cards irmãos marcavam e desmarcavam, sem efeito final.
            seen: set[int] = set()
            for cid in ids:
                note = item.col.get_card(cid).note()
                if int(note.id) in seen:
                    continue
                seen.add(int(note.id))
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
    data = await _upload_bytes(file, MAX_MEDIA_BYTES)
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
    with item.lock:
        safe_name = os.path.basename(filename)
        if safe_name != filename:
            raise HTTPException(400, "Nome de mídia inválido.")
        path = Path(item.col.media.dir()) / safe_name
        if not path.is_file():
            raise HTTPException(404, "Mídia não encontrada.")
    return FileResponse(path)


@app.post("/api/cards-official/editor/media")
async def cards_official_editor_media(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    data = await _upload_bytes(file, MAX_MEDIA_BYTES)
    item = cards_uc_for(user)
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


@app.get("/api/cards-official/media/check")
def cards_official_media_check(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.media.check())


@app.post("/api/cards-official/media/trash")
def cards_official_media_trash(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    files = [str(x) for x in payload.get("files", []) if str(x)]
    with item.lock:
        item.col.media.trash_files(files)
        return {"ok": True, "files": files, "check": pb(item.col.media.check())}


@app.post("/api/cards-official/media/restore-trash")
def cards_official_media_restore_trash(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        item.col.media.restore_trash()
        return {"ok": True, "check": pb(item.col.media.check())}


@app.post("/api/cards-official/media/tag-missing")
def cards_official_media_tag_missing(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    note_ids = sorted({int(x) for x in payload.get("note_ids", []) if int(x) > 0})
    with item.lock:
        # Mesmo fluxo do aqt/mediacheck.py: a lista vem do CheckMediaResponse
        # oficial e a propria Collection aplica a tag canonica missing-media.
        current = pb(item.col.media.check())
        allowed = {
            int(x)
            for x in (
                current.get("missing_media_notes")
                or current.get("missingMediaNotes")
                or []
            )
        }
        invalid = [nid for nid in note_ids if nid not in allowed]
        if invalid:
            raise HTTPException(400, "Notas não constam no CheckMediaResponse atual: " + ", ".join(map(str, invalid)))
        changes = item.col.tags.bulk_add(note_ids, "missing-media") if note_ids else None
        return {
            "ok": True,
            "count": len(note_ids),
            "changes": pb(changes) if changes is not None else {},
            "check": pb(item.col.media.check()),
        }


@app.post("/api/cards-official/media/render-latex")
def cards_official_media_render_latex(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        out = item.col.media.render_all_latex()
        if out is None:
            return {"ok": True, "error": None, "note_id": None, "check": pb(item.col.media.check())}
        note_id, error = out
        return {
            "ok": False,
            "error": str(error),
            "note_id": int(note_id),
            "check": pb(item.col.media.check()),
        }


@app.post("/api/cards-official/media/empty-trash")
def cards_official_media_empty_trash(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        item.col.media.empty_trash()
        return {"ok": True, "check": pb(item.col.media.check())}


@app.post("/api/cards-official/database/check")
def cards_official_database_check(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        message, ok = item.col.fix_integrity()
        return {
            "ok": bool(ok),
            "message": str(message),
            "state": cards_collection_state_payload(item.col),
        }


@app.post("/api/cards-official/database/optimize")
def cards_official_database_optimize(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        item.col.optimize()
        return {"ok": True}


@app.get("/api/cards-official/media/{filename:path}")
def cards_official_media_file(filename: str, user: dict[str, Any] = Depends(current_user)):
    item = cards_uc_for(user)
    with item.lock:
        safe_name = os.path.basename(filename)
        if safe_name != filename:
            raise HTTPException(400, "Nome de mídia inválido.")
        path = Path(item.col.media.dir()) / safe_name
        if not path.is_file():
            raise HTTPException(404, "Mídia não encontrada.")
    return FileResponse(path)



def _set_image_occlusion_comments(col: Collection, note_id: int, comments: str | None) -> None:
    """Comments is the optional fifth stock field (tag=4); standalone I/O RPCs omit it."""
    if comments is None:
        return
    note = col.get_note(note_id)
    nt = note.note_type() or {}
    field_name = None
    for field_cfg in nt.get("flds", []):
        if int(field_cfg.get("tag", -1) or -1) == 4:
            field_name = str(field_cfg.get("name", ""))
            break
    if field_name and field_name in note:
        note[field_name] = str(comments)
        col.update_note(note)


@app.post("/api/cards-official/image-occlusion/setup")
def cards_official_image_occlusion_setup(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        changes = item.col.add_image_occlusion_notetype()
        matches = []
        for nt in item.col.models.all():
            stock = int(nt.get("originalStockKind", nt.get("original_stock_kind", 0)) or 0)
            if stock == 6:
                matches.append({
                    "id": int(nt["id"]),
                    "name": str(nt.get("name", "Image Occlusion")),
                    "notetype": nt,
                    "use_count": int(item.col.models.use_count(nt)),
                })
        return {
            "ok": True,
            "changes": pb(changes) if changes is not None else {},
            "notetypes": matches,
            "state": cards_collection_state_payload(item.col),
        }


@app.post("/api/cards-official/image-occlusion/image")
async def cards_official_image_occlusion_image(
    image: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    data = await _upload_bytes(image, MAX_MEDIA_BYTES)
    item = cards_uc_for(user)
    safe_name = os.path.basename(image.filename or "image.png")
    if not safe_name:
        safe_name = "image.png"
    with item.lock:
        safe_name = item.col.media.add_extension_based_on_mime(
            safe_name,
            image.content_type or "image/png",
        )
        stored = item.col.media.write_data(safe_name, data)
        return {
            "ok": True,
            "filename": stored,
            "content_type": image.content_type or "image/png",
        }


@app.post("/api/cards-official/image-occlusion/note")
def cards_official_add_image_occlusion_note(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        before = set(int(x) for x in item.col.find_notes(""))
        previous_deck = int(item.col.decks.get_current_id())
        requested_deck = int(payload.get("deck_id") or previous_deck)
        try:
            item.col.decks.select(DeckId(requested_deck))
            changes = item.col.add_image_occlusion_note(
                notetype_id=int(payload.get("notetype_id") or 0),
                image_path=str(payload.get("image_path") or ""),
                occlusions=str(payload.get("occlusions") or ""),
                header=str(payload.get("header") or ""),
                back_extra=str(payload.get("back_extra") or ""),
                tags=[str(x) for x in payload.get("tags", [])],
            )
        finally:
            item.col.decks.select(DeckId(previous_deck))
        after = set(int(x) for x in item.col.find_notes(""))
        created = sorted(after - before)
        if len(created) != 1:
            raise HTTPException(500, "O Anki não retornou uma única nota de oclusão criada.")
        note_id = created[0]
        _set_image_occlusion_comments(item.col, note_id, payload.get("comments"))
        note = note_state_payload(item.col, note_id)
        cards = [card_state_payload(item.col, int(cid)) for cid in note["card_ids"]]
        return {
            "ok": True,
            "changes": pb(changes) if changes is not None else {},
            "note": note,
            "cards": cards,
            "state": cards_collection_state_payload(item.col),
            "reviewer": cards_reviewer_payload(item.col),
        }


@app.get("/api/cards-official/image-occlusion/note/{note_id}")
def cards_official_get_image_occlusion_note(
    note_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.get_image_occlusion_note(note_id))


@app.put("/api/cards-official/image-occlusion/note/{note_id}")
def cards_official_update_image_occlusion_note(
    note_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        changes = item.col.update_image_occlusion_note(
            note_id=note_id,
            occlusions=payload.get("occlusions"),
            header=payload.get("header"),
            back_extra=payload.get("back_extra"),
            tags=[str(x) for x in payload.get("tags", [])] if "tags" in payload else None,
        )
        _set_image_occlusion_comments(item.col, note_id, payload.get("comments"))
        note = note_state_payload(item.col, note_id)
        cards = [card_state_payload(item.col, int(cid)) for cid in note["card_ids"]]
        return {
            "ok": True,
            "changes": pb(changes) if changes is not None else {},
            "note": note,
            "cards": cards,
            "state": cards_collection_state_payload(item.col),
            "reviewer": cards_reviewer_payload(item.col),
        }


# ---------------------------------------------------------------------------
# Superfícies avançadas dos Cards executadas na coleção oficial isolada
# ---------------------------------------------------------------------------


def _deck_tree_flatten(node: Any) -> list[dict[str, Any]]:
    rows = [deck_tree_payload(node)]
    for child in getattr(node, "children", []):
        rows.extend(_deck_tree_flatten(child))
    return rows


def cards_collection_state_payload(col: Collection) -> dict[str, Any]:
    """Snapshot oficial necessário para espelhar filtered/custom study no Study.

    Não recalcula busca, fila, due nem membership em JavaScript: todos os cards
    e todos os filtered decks são serializados depois que o scheduler oficial
    terminou a operação.
    """
    tree = col.sched.deck_due_tree()
    nodes = _deck_tree_flatten(tree)
    by_id = {int(row["deck_id"]): row for row in nodes}
    decks: list[dict[str, Any]] = []
    for named in col.decks.all_names_and_ids():
        did = int(getattr(named, "id", 0))
        node = by_id.get(did, {})
        row: dict[str, Any] = {
            "id": did,
            "name": str(named.name),
            "filtered": bool(node.get("filtered", False)),
        }
        if row["filtered"]:
            row["filtered_deck"] = pb(col.sched.get_or_create_filtered_deck(DeckId(did)))
        decks.append(row)
    card_ids = [int(x) for x in col.find_cards("")]
    return {
        "decks": decks,
        "cards": [card_state_payload(col, cid) for cid in card_ids],
        "reviewer": cards_reviewer_payload(col),
    }


def cards_collection_full_state_payload(col: Collection) -> dict[str, Any]:
    """Snapshot integral para espelho de UI após importações oficiais."""
    state = cards_collection_state_payload(col)
    note_ids = [int(x) for x in col.find_notes("")]
    state["notetypes"] = [
        {"notetype": nt, "use_count": int(col.models.use_count(nt))}
        for nt in col.models.all()
    ]
    state["notes"] = [note_state_payload(col, nid) for nid in note_ids]
    return state


@app.get("/api/cards-official/preferences")
def cards_official_preferences(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.get_preferences())


@app.put("/api/cards-official/preferences")
def cards_official_update_preferences(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        prefs = item.col.get_preferences()
        scheduling = payload.get("scheduling") if isinstance(payload.get("scheduling"), dict) else {}
        if "rollover" in scheduling:
            prefs.scheduling.rollover = max(0, min(23, int(scheduling["rollover"])))
        if "learn_ahead_secs" in scheduling:
            prefs.scheduling.learn_ahead_secs = max(0, min(86400, int(scheduling["learn_ahead_secs"])))
        changes = item.col.set_preferences(prefs)
        return {
            "ok": True,
            "preferences": pb(item.col.get_preferences()),
            "changes": pb(changes),
            "state": cards_collection_state_payload(item.col),
        }


@app.get("/api/cards-official/collection/state")
def cards_official_collection_state(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return cards_collection_state_payload(item.col)


@app.get("/api/cards-official/collection/full-state")
def cards_official_collection_full_state(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return cards_collection_full_state_payload(item.col)


@app.get("/api/cards-official/stats/graphs")
def cards_official_collection_graphs(
    search: str = Query(default=""),
    days: int = Query(default=365, ge=0, le=36500),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col._backend.graphs(search=search, days=days))


@app.post("/api/cards-official/stats/graphs/scoped")
def cards_official_collection_graphs_scoped(
    body: ScopedStatsBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        known = {int(cid) for cid in item.col.find_cards("")}
        ids = sorted({int(cid) for cid in body.card_ids if int(cid) in known})
        # A gramática cid: é nativa do Anki e aceita múltiplos IDs. O GraphsService
        # continua sendo a única fonte dos números; só delimitamos sua busca.
        scope = "cid:" + (",".join(str(cid) for cid in ids) if ids else "0")
        native = str(body.search or "").strip()
        search = f"({native}) {scope}" if native else scope
        return pb(item.col._backend.graphs(search=search, days=int(body.days)))


@app.post("/api/cards-official/fsrs/optimize")
def cards_official_fsrs_optimize(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
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


@app.post("/api/cards-official/fsrs/simulate")
def cards_official_fsrs_simulate(
    payload: dict[str, Any],
    mode: str = Query(default="review"),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
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


@app.post("/api/cards-official/decks")
def cards_official_add_deck(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Informe o nome do baralho.")
    item = cards_uc_for(user)
    with item.lock:
        out = item.col.decks.add_normal_deck_with_name(name)
        return {
            "ok": True,
            "deck_id": int(out.id),
            "changes": pb(out.changes) if getattr(out, "changes", None) is not None else {},
            "state": cards_collection_state_payload(item.col),
        }


@app.put("/api/cards-official/deck/{deck_id}")
def cards_official_rename_deck(
    deck_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Informe o novo nome do baralho.")
    item = cards_uc_for(user)
    with item.lock:
        changes = item.col.decks.rename(DeckId(deck_id), name)
        return {
            "ok": True,
            "deck_id": int(deck_id),
            "changes": pb(changes) if changes is not None else {},
            "state": cards_collection_state_payload(item.col),
        }


@app.delete("/api/cards-official/deck/{deck_id}")
def cards_official_delete_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        before_cards = {int(x) for x in item.col.find_cards("")}
        before_notes = {int(x) for x in item.col.find_notes("")}
        changes = item.col.decks.remove([DeckId(deck_id)])
        after_cards = {int(x) for x in item.col.find_cards("")}
        after_notes = {int(x) for x in item.col.find_notes("")}
        return {
            "ok": True,
            "deck_id": int(deck_id),
            "deleted_card_ids": sorted(before_cards - after_cards),
            "deleted_note_ids": sorted(before_notes - after_notes),
            "changes": pb(changes) if changes is not None else {},
            "state": cards_collection_state_payload(item.col),
        }


@app.get("/api/cards-official/deck/{deck_id}/options")
def cards_official_deck_options(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.decks.get_deck_configs_for_update(DeckId(deck_id)))


@app.put("/api/cards-official/deck/{deck_id}/options")
def cards_official_update_deck_options(
    deck_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
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
        return {
            "options": pb(item.col.decks.get_deck_configs_for_update(DeckId(deck_id))),
            # Alterar Deck Options pode ajustar passos, ordenar novos e, com
            # fsrs_reschedule, recomputar memória/vencimento. O Study recebe
            # exatamente o estado posterior à transação oficial.
            "state": cards_collection_state_payload(item.col),
        }


@app.get("/api/cards-official/custom-study/defaults/{deck_id}")
def cards_official_custom_study_defaults(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
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


@app.post("/api/cards-official/custom-study")
def cards_official_custom_study(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    request = scheduler_pb2.CustomStudyRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise HTTPException(400, f"Estudo personalizado inválido: {exc}") from exc
    with item.lock:
        changes = pb(item.col.sched.custom_study(request))
        return {
            "ok": True,
            "changes": changes,
            "state": cards_collection_state_payload(item.col),
        }


@app.get("/api/cards-official/filtered-deck/{deck_id}")
def cards_official_get_filtered_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return {
            "deck": pb(item.col.sched.get_or_create_filtered_deck(DeckId(deck_id))),
            "orders": list(item.col.sched.filtered_deck_order_labels()),
        }


@app.put("/api/cards-official/filtered-deck/{deck_id}")
def cards_official_update_filtered_deck(
    deck_id: int,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        current = item.col.sched.get_or_create_filtered_deck(DeckId(deck_id))
        try:
            ParseDict(payload, current, ignore_unknown_fields=False)
        except Exception as exc:
            raise HTTPException(400, f"Baralho filtrado inválido: {exc}") from exc
        out = item.col.sched.add_or_update_filtered_deck(current)
        return {
            "ok": True,
            "deck_id": int(out.id),
            "deck": pb(current),
            "state": cards_collection_state_payload(item.col),
        }


@app.post("/api/cards-official/filtered-deck/{deck_id}/rebuild")
def cards_official_rebuild_filtered_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        changes = pb(item.col.sched.rebuild_filtered_deck(DeckId(deck_id)))
        return {
            "ok": True,
            "changes": changes,
            "state": cards_collection_state_payload(item.col),
        }


@app.post("/api/cards-official/filtered-deck/{deck_id}/empty")
def cards_official_empty_filtered_deck(
    deck_id: int,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        changes = pb(item.col.sched.empty_filtered_deck(DeckId(deck_id)))
        return {
            "ok": True,
            "changes": changes,
            "state": cards_collection_state_payload(item.col),
        }


@app.get("/api/cards-official/empty-cards")
def cards_official_empty_cards_report(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    with item.lock:
        return pb(item.col.get_empty_cards())


@app.post("/api/cards-official/empty-cards/delete")
def cards_official_delete_empty_cards(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    ids = sorted({int(x) for x in payload.get("card_ids", []) if int(x) > 0})
    with item.lock:
        # A lista vem do EmptyCardsReport oficial. Não tentamos decidir no
        # servidor web quais cards são "vazios": a mesma Collection do Anki
        # executa remove_cards_and_orphaned_notes(), exatamente como
        # aqt/emptycards.py. O snapshot posterior permite espelhar o resultado.
        before = pb(item.col.get_empty_cards())
        empty_ids = {
            int(card_id)
            for note in before.get("notes", [])
            for card_id in note.get("card_ids", [])
        }
        invalid = [card_id for card_id in ids if card_id not in empty_ids]
        if invalid:
            raise HTTPException(400, "Cards não constam no EmptyCardsReport atual: " + ", ".join(map(str, invalid)))
        changes = pb(item.col.remove_cards_and_orphaned_notes(ids))
        return {
            "ok": True,
            "deleted_card_ids": ids,
            "report_before": before,
            "changes": changes,
            "state": cards_collection_state_payload(item.col),
        }


def _import_update_condition(value: str) -> int:
    return {
        "if-newer": import_export_pb2.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_IF_NEWER,
        "always": import_export_pb2.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_ALWAYS,
        "never": import_export_pb2.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_NEVER,
    }.get(str(value or "if-newer").lower(), import_export_pb2.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_IF_NEWER)


def _csv_delimiter(value: str | None):
    if value is None or str(value).strip() == "":
        return None
    key = str(value).strip().lower()
    mapping = {
        "tab": import_export_pb2.CsvMetadata.TAB,
        "pipe": import_export_pb2.CsvMetadata.PIPE,
        "semicolon": import_export_pb2.CsvMetadata.SEMICOLON,
        "colon": import_export_pb2.CsvMetadata.COLON,
        "comma": import_export_pb2.CsvMetadata.COMMA,
        "space": import_export_pb2.CsvMetadata.SPACE,
    }
    if key not in mapping:
        raise HTTPException(400, f"Separador CSV inválido: {value}")
    return mapping[key]


@app.post("/api/cards-official/import/mnemosyne")
async def cards_official_import_mnemosyne(
    file: UploadFile = File(...),
    deck_id: int | None = Query(default=None),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = file.filename or "mnemosyne.db"
    if not name.lower().endswith(".db"):
        raise HTTPException(400, "Use um banco .db do Mnemosyne.")
    item = cards_uc_for(user)
    tmp = await _upload_to_tempfile(file, ".db", MAX_IMPORT_BYTES)
    try:
        with item.lock:
            target = DeckId(deck_id) if deck_id else item.col.decks.get_current_id()
            foreign_json = mnemosyne.serialize(tmp, target)
            result = item.col.import_json_string(foreign_json)
            return {
                "ok": True,
                "result": pb(result),
                "state": cards_collection_full_state_payload(item.col),
            }
    finally:
        _unlink_quiet(tmp)


@app.post("/api/cards-official/import/csv/metadata")
async def cards_official_csv_metadata(
    file: UploadFile = File(...),
    delimiter: str | None = Query(default=None),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    tmp = await _upload_to_tempfile(file, Path(file.filename or "import.txt").suffix or ".txt", MAX_IMPORT_BYTES)
    try:
        with item.lock:
            meta = item.col.get_csv_metadata(tmp, _csv_delimiter(delimiter))
            return {"ok": True, "metadata": pb(meta)}
    finally:
        _unlink_quiet(tmp)


@app.post("/api/cards-official/import/csv")
async def cards_official_import_csv(
    file: UploadFile = File(...),
    metadata_json: str = Form(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    item = cards_uc_for(user)
    tmp = await _upload_to_tempfile(file, Path(file.filename or "import.txt").suffix or ".txt", MAX_IMPORT_BYTES)
    try:
        try:
            raw = json.loads(metadata_json)
        except Exception as exc:
            raise HTTPException(400, f"Metadados CSV inválidos: {exc}") from exc
        metadata = import_export_pb2.CsvMetadata()
        try:
            ParseDict(raw, metadata, ignore_unknown_fields=False)
        except Exception as exc:
            raise HTTPException(400, f"Contrato CsvMetadata inválido: {exc}") from exc
        request = import_export_pb2.ImportCsvRequest(path=tmp, metadata=metadata)
        with item.lock:
            result = item.col.import_csv(request)
            return {
                "ok": True,
                "result": pb(result),
                "state": cards_collection_full_state_payload(item.col),
            }
    finally:
        _unlink_quiet(tmp)


@app.get("/api/cards-official/export/notes-text")
def cards_official_export_notes_text(
    deck_id: int | None = Query(default=None),
    with_html: bool = Query(default=True),
    with_tags: bool = Query(default=True),
    with_deck: bool = Query(default=True),
    with_notetype: bool = Query(default=True),
    with_guid: bool = Query(default=True),
    user: dict[str, Any] = Depends(current_user),
):
    item = cards_uc_for(user)
    tmp = _new_tempfile(".txt")
    try:
        with item.lock:
            count = item.col.export_note_csv(
                out_path=tmp,
                limit=DeckIdLimit(DeckId(deck_id)) if deck_id else None,
                with_html=bool(with_html),
                with_tags=bool(with_tags),
                with_deck=bool(with_deck),
                with_notetype=bool(with_notetype),
                with_guid=bool(with_guid),
            )
    except BaseException:
        _unlink_quiet(tmp)
        raise
    response = _file_response(tmp, "StudyNoMentor-Cards-notes.txt", "text/plain; charset=utf-8")
    response.headers["X-Anki-Exported-Notes"] = str(int(count))
    return response


@app.get("/api/cards-official/export/cards-text")
def cards_official_export_cards_text(
    deck_id: int | None = Query(default=None),
    with_html: bool = Query(default=True),
    user: dict[str, Any] = Depends(current_user),
):
    item = cards_uc_for(user)
    tmp = _new_tempfile(".txt")
    try:
        with item.lock:
            count = item.col.export_card_csv(
                out_path=tmp,
                limit=DeckIdLimit(DeckId(deck_id)) if deck_id else None,
                with_html=bool(with_html),
            )
    except BaseException:
        _unlink_quiet(tmp)
        raise
    response = _file_response(tmp, "StudyNoMentor-Cards-cards.txt", "text/plain; charset=utf-8")
    response.headers["X-Anki-Exported-Cards"] = str(int(count))
    return response


@app.post("/api/cards-official/import/apkg")
async def cards_official_import_apkg(
    package: UploadFile = File(...),
    with_scheduling: bool = Query(default=True),
    with_deck_configs: bool = Query(default=True),
    merge_notetypes: bool = Query(default=True),
    update_notes: str = Query(default="if-newer"),
    update_notetypes: str = Query(default="if-newer"),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = package.filename or "import.apkg"
    if not name.lower().endswith((".apkg", ".zip")):
        raise HTTPException(400, "Use um pacote .apkg do Anki.")
    item = cards_uc_for(user)
    tmp = await _upload_to_tempfile(package, ".apkg", MAX_IMPORT_BYTES)
    try:
        with item.lock:
            request = ImportAnkiPackageRequest(
                package_path=tmp,
                options=ImportAnkiPackageOptions(
                    merge_notetypes=bool(merge_notetypes),
                    update_notes=_import_update_condition(update_notes),
                    update_notetypes=_import_update_condition(update_notetypes),
                    with_scheduling=bool(with_scheduling),
                    with_deck_configs=bool(with_deck_configs),
                ),
            )
            result = item.col.import_anki_package(request)
            return {
                "ok": True,
                "result": pb(result),
                "state": cards_collection_full_state_payload(item.col),
            }
    finally:
        _unlink_quiet(tmp)


@app.post("/api/cards-official/import/colpkg")
async def cards_official_import_colpkg(
    package: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = package.filename or "collection.colpkg"
    if not name.lower().endswith((".colpkg", ".apkg")):
        raise HTTPException(400, "Use um pacote de coleção do Anki.")
    item = cards_uc_for(user)
    tmp = await _upload_to_tempfile(package, ".colpkg", MAX_IMPORT_BYTES)
    backup = item.root / f"before-cards-colpkg-import-{int(time.time())}.anki2"
    try:
        with item.lock:
            if item.collection_path.exists():
                item.col.close()
                shutil.copy2(item.collection_path, backup)
                item.col.reopen()
            backend = item.col._backend
            item.col.close()
            try:
                media_folder, media_db = media_paths_from_col_path(str(item.collection_path))
                backend.import_collection_package(
                    import_export_pb2.ImportCollectionPackageRequest(
                        col_path=str(item.collection_path),
                        backup_path=tmp,
                        media_folder=media_folder,
                        media_db=media_db,
                    )
                )
            except BaseException:
                if backup.exists():
                    try:
                        shutil.copy2(backup, item.collection_path)
                    except OSError:
                        pass
                raise
            finally:
                item.col.reopen()
            return {
                "ok": True,
                "cards": int(item.col.card_count()),
                "notes": int(item.col.note_count()),
                "state": cards_collection_full_state_payload(item.col),
            }
    finally:
        _unlink_quiet(tmp)


@app.get("/api/cards-official/export/apkg")
def cards_official_export_apkg(
    deck_id: int | None = Query(default=None),
    with_scheduling: bool = Query(default=True),
    with_deck_configs: bool = Query(default=True),
    with_media: bool = Query(default=True),
    legacy: bool = Query(default=False),
    user: dict[str, Any] = Depends(current_user),
):
    item = cards_uc_for(user)
    tmp = _new_tempfile(".apkg")
    try:
        with item.lock:
            count = item.col.export_anki_package(
                out_path=tmp,
                options=ExportAnkiPackageOptions(
                    with_scheduling=bool(with_scheduling),
                    with_deck_configs=bool(with_deck_configs),
                    with_media=bool(with_media),
                    legacy=bool(legacy),
                ),
                limit=DeckIdLimit(DeckId(deck_id)) if deck_id else None,
            )
    except BaseException:
        _unlink_quiet(tmp)
        raise
    response = _file_response(tmp, "StudyNoMentor-Cards.apkg", "application/octet-stream")
    response.headers["X-Anki-Exported-Cards"] = str(int(count))
    return response


@app.get("/api/cards-official/export/colpkg")
def cards_official_export_colpkg(
    with_media: bool = Query(default=True),
    legacy: bool = Query(default=False),
    user: dict[str, Any] = Depends(current_user),
):
    item = cards_uc_for(user)
    tmp = _new_tempfile(".colpkg")
    try:
        with item.lock:
            try:
                item.col.export_collection_package(tmp, include_media=bool(with_media), legacy=bool(legacy))
            finally:
                item.col.reopen()
    except BaseException:
        _unlink_quiet(tmp)
        raise
    return _file_response(tmp, "StudyNoMentor-Cards.colpkg", "application/octet-stream")


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
    item = uc_for(user)
    tmp = await _upload_to_tempfile(package, ".apkg", MAX_IMPORT_BYTES)
    try:
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
        _unlink_quiet(tmp)


def _file_response(tmp: str, filename: str, media_type: str) -> FileResponse:
    return FileResponse(
        tmp,
        filename=filename,
        media_type=media_type,
        background=BackgroundTask(_unlink_quiet, tmp),
    )


@app.get("/api/anki/export/apkg")
def export_apkg(user: dict[str, Any] = Depends(current_user)):
    item = uc_for(user)
    tmp = _new_tempfile(".apkg")
    try:
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
    except BaseException:
        _unlink_quiet(tmp)
        raise
    return _file_response(tmp, "StudyNoMentor-Anki.apkg", "application/octet-stream")


@app.post("/api/anki/import/colpkg")
async def import_colpkg(
    package: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    name = package.filename or "collection.colpkg"
    if not name.lower().endswith(".colpkg"):
        raise HTTPException(400, "Use um pacote .colpkg do Anki.")
    item = uc_for(user)
    tmp = await _upload_to_tempfile(package, ".colpkg", MAX_IMPORT_BYTES)
    try:
        with item.lock:
            # Cópia de segurança com carimbo: a importação de uma coleção
            # substitui tudo, e a cópia anterior não pode ser sobrescrita pela
            # próxima importação.
            backup = item.root / f"before-colpkg-import-{int(time.time())}.anki2"
            if item.collection_path.exists():
                item.col.close()
                shutil.copy2(item.collection_path, backup)
                item.col.reopen()
            backend = item.col._backend
            item.col.close()
            try:
                media_folder, media_db = media_paths_from_col_path(str(item.collection_path))
                backend.import_collection_package(
                    import_export_pb2.ImportCollectionPackageRequest(
                        col_path=str(item.collection_path),
                        backup_path=tmp,
                        media_folder=media_folder,
                        media_db=media_db,
                    )
                )
            except BaseException:
                # Falhou no meio: volta a coleção anterior antes de reabrir.
                # Sem isto a coleção do usuário ficava FECHADA até o processo
                # reiniciar (toda requisição seguinte falhava).
                if backup.exists():
                    try:
                        shutil.copy2(backup, item.collection_path)
                    except OSError:
                        pass
                raise
            finally:
                item.col.reopen()
            return {"ok": True, "cards": int(item.col.card_count()), "notes": int(item.col.note_count())}
    finally:
        _unlink_quiet(tmp)


@app.get("/api/anki/export/colpkg")
def export_colpkg(user: dict[str, Any] = Depends(current_user)):
    item = uc_for(user)
    tmp = _new_tempfile(".colpkg")
    try:
        with item.lock:
            try:
                item.col.export_collection_package(tmp, include_media=True, legacy=False)
            finally:
                item.col.reopen()
    except BaseException:
        _unlink_quiet(tmp)
        raise
    return _file_response(tmp, "StudyNoMentor-Anki.colpkg", "application/octet-stream")


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
    suffix = Path(package.filename or "import.csv").suffix or ".csv"
    item = uc_for(user)
    tmp = await _upload_to_tempfile(package, suffix, MAX_IMPORT_BYTES)
    try:
        with item.lock:
            return pb(item.col.get_csv_metadata(tmp, None))
    finally:
        _unlink_quiet(tmp)


@app.post("/api/anki/import/csv")
async def import_csv(
    package: UploadFile = File(...),
    metadata_json: str | None = Form(default=None),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    suffix = Path(package.filename or "import.csv").suffix or ".csv"
    item = uc_for(user)
    tmp = await _upload_to_tempfile(package, suffix, MAX_IMPORT_BYTES)
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
        _unlink_quiet(tmp)


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
    tmp = _new_tempfile(".txt")
    try:
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
    except BaseException:
        _unlink_quiet(tmp)
        raise
    return _file_response(tmp, "StudyNoMentor-Anki-notes.txt", "text/plain; charset=utf-8")


@app.get("/api/anki/export/cards.csv")
def export_cards_csv(
    html: bool = Query(default=True),
    user: dict[str, Any] = Depends(current_user),
):
    item = uc_for(user)
    tmp = _new_tempfile(".txt")
    try:
        with item.lock:
            item.col.export_card_csv(out_path=tmp, limit=None, with_html=html)
    except BaseException:
        _unlink_quiet(tmp)
        raise
    return _file_response(tmp, "StudyNoMentor-Anki-cards.txt", "text/plain; charset=utf-8")


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
    data = await _upload_bytes(image, MAX_MEDIA_BYTES)
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
