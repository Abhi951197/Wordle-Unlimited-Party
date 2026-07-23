from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pathlib import Path
import uuid
import os
import string
import random
import hashlib

from words import get_word, VALID_GUESSES, ANSWER_WORDS
from word_metadata import get_word_metadata, validate_metadata_coverage
from leaderboard import (
    init_db,
    import_player_stats,
    leaderboard as get_leaderboard,
    public_profile as get_public_profile,
    record_result,
    register_player,
    username_available,
    validate_username,
)

load_dotenv(Path(__file__).resolve().parent / ".env")

try:
    from livekit import api as livekit_api
except ImportError:  # LiveKit voice is disabled until livekit-api is installed.
    livekit_api = None

app = FastAPI(title="World Unlimited API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for game sessions (MVP)
from typing import Dict, Any
sessions: Dict[str, Dict[str, Any]] = {}
rooms: Dict[str, Dict[str, Any]] = {}

MAX_ROOM_PLAYERS = 8
ROOM_IDLE_TTL = timedelta(minutes=45)

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

missing_metadata = validate_metadata_coverage()
if missing_metadata and os.getenv("RENDER") != "true":
    raise RuntimeError(f"Missing word metadata for {len(missing_metadata)} answers")

init_db()

class GameCreateResponse(BaseModel):
    session_id: str
    length: int
    daily_date: str | None = None

class StatsImportRequest(BaseModel):
    user_id: str
    leaderboard_token: str
    stats_by_scope: dict[str, Any]

class GuessRequest(BaseModel):
    session_id: str
    guess: str
    leaderboard_user_id: str | None = None
    leaderboard_token: str | None = None

class GuessResponse(BaseModel):
    states: list[str]  # e.g. ["correct", "present", "absent", ...]
    game_over: bool
    won: bool
    answer: str | None = None
    answer_info: dict[str, str] | None = None
    hints_used: int = 0

class PlayerRequest(BaseModel):
    player_name: str = "Player"
    leaderboard_user_id: str | None = None
    leaderboard_token: str | None = None
    player_id: str | None = None
    player_emoji: str = "🙂"

class RoomCreateRequest(PlayerRequest):
    difficulty: str = "easy"

class RoomJoinRequest(PlayerRequest):
    pass

class RoomGuessRequest(BaseModel):
    player_id: str
    guess: str
    leaderboard_user_id: str | None = None
    leaderboard_token: str | None = None

class RoomInputRequest(BaseModel):
    player_id: str
    current_guess: str
    client_input_version: int | None = None

class RoomDifficultyRequest(BaseModel):
    player_id: str
    difficulty: str

class ActiveBoardRequest(BaseModel):
    player_id: str
    board: str

class ShareRequestCreate(BaseModel):
    player_id: str

class ShareRequestRespond(BaseModel):
    player_id: str
    accept: bool

class RoomChatRequest(BaseModel):
    player_id: str
    text: str

class LiveKitInfo(BaseModel):
    configured: bool
    url: str | None = None
    token: str | None = None

class ChatMessage(BaseModel):
    message_id: str
    player_id: str
    player_name: str
    player_emoji: str
    text: str
    created_at: str

class RoomPlayer(BaseModel):
    player_id: str
    player_name: str
    player_emoji: str = "🙂"
    joined_at: str
    last_active_at: str | None = None

class BoardState(BaseModel):
    session_id: str
    difficulty: str
    daily_date: str | None = None
    length: int
    guesses: list[str]
    results: list[list[str]]
    current_guess: str = ""
    input_version: int = 0
    game_over: bool
    won: bool
    answer: str | None = None
    answer_info: dict[str, str] | None = None
    hints_used: int = 0
    hints: list[dict[str, Any]] = []
    typing_player_id: str | None = None
    typing_player_name: str | None = None
    typing_player_emoji: str | None = None

class ShareRequestState(BaseModel):
    from_player_id: str
    from_player_name: str
    session_id: str
    created_at: str

class RoomStateResponse(BaseModel):
    room_id: str
    session_id: str
    difficulty: str
    length: int
    guesses: list[str]
    results: list[list[str]]
    current_guess: str = ""
    input_version: int = 0
    game_over: bool
    won: bool
    answer: str | None = None
    answer_info: dict[str, str] | None = None
    hints_used: int = 0
    hints: list[dict[str, Any]] = []
    players: list[RoomPlayer]
    livekit: LiveKitInfo | None = None
    host_player_id: str | None = None
    active_board: str = "shared"
    shared_board: BoardState | None = None
    individual_board: BoardState | None = None
    share_request: ShareRequestState | None = None
    chat_messages: list[ChatMessage] = []
    max_players: int = MAX_ROOM_PLAYERS
    typing_player_id: str | None = None
    typing_player_name: str | None = None
    typing_player_emoji: str | None = None

class RoomJoinResponse(RoomStateResponse):
    player_id: str

class HintResponse(BaseModel):
    hint: str
    level: int
    hints_used: int
    max_hints: int = 2
    kind: str
    revealed_position: int | None = None
    revealed_letter: str | None = None

class PlayerRegisterRequest(BaseModel):
    username: str
    emoji: str = "🙂"
    user_id: str | None = None
    leaderboard_token: str | None = None

class PlayerRegisterResponse(BaseModel):
    user_id: str
    username: str
    emoji: str
    leaderboard_token: str

class UsernameAvailabilityResponse(BaseModel):
    username: str
    available: bool
    valid: bool
    message: str | None = None

class LeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    username: str
    emoji: str
    score: int
    games_played: int
    wins: int
    losses: int
    win_rate: int
    current_streak: int
    max_streak: int
    avg_guesses: float | None = None
    hint_games: int = 0
    hint_wins: int = 0
    total_guesses: int = 0
    guess_distribution: list[int] = [0, 0, 0, 0, 0, 0]
    badges: list[dict[str, Any]] = []

class LeaderboardResponse(BaseModel):
    scope: str
    period: str = "weekly"
    period_key: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    resets_at: str | None = None
    entries: list[LeaderboardEntry]
    current_user: LeaderboardEntry | None = None
    scoring: dict[str, Any]

class PublicProfileResponse(BaseModel):
    player: dict[str, Any]
    period: dict[str, Any]
    ranks: dict[str, int | None]
    all_time: dict[str, dict[str, Any]]
    weekly: dict[str, dict[str, Any]]
    achievements: list[dict[str, Any]]

@app.get("/")
def read_root():
    return {"message": "Welcome to World Unlimited API"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

def _scoring_rules() -> dict[str, Any]:
    return {
        "base_points": {"easy": 100, "moderate": 140, "difficult": 180, "prodigy": 250},
        "efficiency_bonus": "10 * remaining guesses",
        "no_hint_bonus": 15,
        "hint_penalty": "10 * hints used",
        "loss_points": 0,
        "formula": "base win points + efficiency bonus + no-hint bonus - hint penalty",
    }

@app.post("/players/register", response_model=PlayerRegisterResponse)
def register_public_player(req: PlayerRegisterRequest):
    try:
        return register_player(req.username, req.emoji, req.user_id, req.leaderboard_token)
    except ValueError as exc:
        raise HTTPException(status_code=409 if "taken" in str(exc).lower() else 400, detail=str(exc))

@app.get("/players/check-username", response_model=UsernameAvailabilityResponse)
def check_public_username(username: str):
    try:
        normalized = validate_username(username)
        return UsernameAvailabilityResponse(username=normalized, available=username_available(normalized), valid=True)
    except ValueError as exc:
        return UsernameAvailabilityResponse(username=username.strip().lower(), available=False, valid=False, message=str(exc))

@app.get("/leaderboard", response_model=LeaderboardResponse)
def read_leaderboard(scope: str = "overall", limit: int = 50, player_id: str | None = None, period: str = "weekly", week: str = "current"):
    data = get_leaderboard(scope, limit, player_id, period, week)
    return LeaderboardResponse(**data, scoring=_scoring_rules())

@app.post("/players/stats/import")
def import_public_player_stats(req: StatsImportRequest):
    imported = import_player_stats(req.user_id, req.leaderboard_token, req.stats_by_scope)
    if not imported:
        raise HTTPException(status_code=403, detail="Could not import player stats")
    return {"imported": True}

@app.get("/players/{user_id}/public-profile", response_model=PublicProfileResponse)
def read_public_profile(user_id: str):
    profile = get_public_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Player not found")
    return PublicProfileResponse(**profile)

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def _cleanup_idle_rooms() -> None:
    cutoff = datetime.now(timezone.utc) - ROOM_IDLE_TTL
    stale_rooms = [
        room_id
        for room_id, room in rooms.items()
        if _parse_dt(room.get("last_active_at") or room.get("created_at")) < cutoff
    ]
    for room_id in stale_rooms:
        room = rooms.pop(room_id, None)
        if not room:
            continue
        session_ids = set(room.get("player_sessions", {}).values())
        if room.get("active_shared_session_id"):
            session_ids.add(room["active_shared_session_id"])
        for session_id in session_ids:
            sessions.pop(session_id, None)

def _touch_room(room: dict[str, Any], player_id: str | None = None) -> None:
    now = _now_iso()
    room["last_active_at"] = now
    if player_id and player_id in room.get("players", {}):
        room["players"][player_id]["last_active_at"] = now

def _room_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choice(alphabet) for _ in range(6))
        if code not in rooms:
            return code

def _clean_player_name(player_name: str) -> str:
    name = player_name.strip()
    if not name:
        return "Player"
    return name[:32]

def _clean_player_emoji(player_emoji: str | None) -> str:
    emoji = (player_emoji or "🙂").strip()
    return emoji[:4] or "🙂"

def _daily_word_for(date_key: str) -> str:
    digest = hashlib.sha256(f"wordle-daily:{date_key}".encode("utf-8")).hexdigest()
    index = int(digest[:12], 16) % len(ANSWER_WORDS)
    return ANSWER_WORDS[index]

def _create_session(difficulty: str, word: str | None = None, daily_date: str | None = None) -> str:
    word = word or get_word(difficulty)
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "word": word,
        "difficulty": difficulty,
        "daily_date": daily_date,
        "guesses": [],
        "results": [],
        "current_guess": "",
        "input_version": 0,
        "hints_used": 0,
        "hints": [],
        "hint_assisted": False,
        "game_over": False,
        "won": False,
        "leaderboard_participants": {},
        "leaderboard_mode": "solo",
        "leaderboard_shared_board": False,
        "typing_player_id": None,
        "typing_player_name": None,
        "typing_player_emoji": None,
    }
    return session_id

def _answer_info_for_session(session: dict[str, Any]) -> dict[str, str] | None:
    if not session.get("game_over"):
        return None
    return get_word_metadata(session.get("word"))

def _ordinal(value: int) -> str:
    if 10 <= value % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"

def _plain_definition(text: str) -> str:
    source = text or ""
    first_clause = source.split(";", 1)[0].strip()
    if len(first_clause) >= 18:
        source = first_clause
    cleaned = " ".join(source.split())
    return cleaned.rstrip(".")

def _human_meaning_hint(word: str, info: dict[str, str]) -> str:
    definition = _plain_definition(info.get("definition", ""))
    part_of_speech = (info.get("part_of_speech") or "word").lower()
    weak_definition = "valid english word used in wordle-style puzzles" in definition.lower()

    if not definition or weak_definition:
        return f"A valid word. {info.get('structure_hint') or _word_shape_hint(word)}"

    lower = definition[:1].lower() + definition[1:]
    if part_of_speech == "verb":
        return f"An action meaning: {lower}."
    if part_of_speech == "adjective":
        return f"Describes something as: {lower}."
    if lower.startswith(("a ", "an ", "the ", "any ")):
        return f"Think of {lower}."
    if lower.endswith("s") and " " in lower:
        return f"Something that {lower}."
    return f"Think of something related to: {lower}."

def _word_shape_hint(word: str) -> str:
    vowels = sum(1 for ch in word if ch in "AEIOU")
    repeated = len(set(word)) != len(word)
    repeated_text = "has a repeated letter" if repeated else "has no repeated letters"
    return f"It has {vowels} vowel{'s' if vowels != 1 else ''} and {repeated_text}."

def _letter_hint_for_session(session: dict[str, Any]) -> dict[str, Any]:
    word = session["word"]
    solved_positions = {
        index
        for result in session.get("results", [])
        for index, state in enumerate(result)
        if state == "correct"
    }
    available_positions = [index for index in range(len(word)) if index not in solved_positions]
    if not available_positions:
        hint = get_word_metadata(word).get("structure_hint") or _word_shape_hint(word)
        return {"hint": hint, "kind": "structure"}

    position = available_positions[len(available_positions) // 2]
    letter = word[position]
    one_based = position + 1
    return {
        "hint": f"The {_ordinal(one_based)} letter is {letter}.",
        "kind": "letter",
        "revealed_position": one_based,
        "revealed_letter": letter,
    }

def _board_state(session_id: str | None) -> BoardState | None:
    if not session_id or session_id not in sessions:
        return None

    session = sessions[session_id]
    return BoardState(
        session_id=session_id,
        difficulty=session["difficulty"],
        daily_date=session.get("daily_date"),
        length=len(session["word"]),
        guesses=session["guesses"],
        results=session["results"],
        current_guess=session.get("current_guess", ""),
        input_version=session.get("input_version", 0),
        game_over=session["game_over"],
        won=session["won"],
        answer=session["word"] if session["game_over"] else None,
        answer_info=_answer_info_for_session(session),
        hints_used=session.get("hints_used", 0),
        hints=session.get("hints", []),
        typing_player_id=session.get("typing_player_id"),
        typing_player_name=session.get("typing_player_name"),
        typing_player_emoji=session.get("typing_player_emoji"),
    )

def _evaluate_guess(target_word: str, guess: str) -> list[str]:
    target_letters = list(target_word)
    guess_letters = list(guess)
    states = ["absent"] * len(target_word)

    for i in range(len(target_word)):
        if guess_letters[i] == target_letters[i]:
            states[i] = "correct"
            target_letters[i] = None

    for i in range(len(target_word)):
        if states[i] == "absent" and guess_letters[i] in target_letters:
            states[i] = "present"
            target_letters[target_letters.index(guess_letters[i])] = None

    return states

def _livekit_token(room_id: str, player_id: str, player_name: str) -> LiveKitInfo:
    if not (LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET and livekit_api):
        return LiveKitInfo(configured=False)

    token = (
        livekit_api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(player_id)
        .with_name(player_name)
        .with_grants(livekit_api.VideoGrants(room_join=True, room=room_id))
        .to_jwt()
    )
    return LiveKitInfo(configured=True, url=LIVEKIT_URL, token=token)

def _room_state(room_id: str, player_id: str | None = None) -> RoomStateResponse:
    _cleanup_idle_rooms()
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")

    room = rooms[room_id]
    if player_id and player_id not in room["player_sessions"]:
        room["player_sessions"][player_id] = _create_session(room.get("difficulty", "easy"))
    active_board = room["player_active_boards"].get(player_id, "shared") if player_id else "shared"
    shared_session_id = room.get("active_shared_session_id")
    individual_session_id = room["player_sessions"].get(player_id) if player_id else None
    active_session_id = (
        individual_session_id
        if active_board == "individual" and individual_session_id
        else shared_session_id or individual_session_id
    )
    session = sessions[active_session_id]
    livekit = None
    if player_id and player_id in room["players"]:
        livekit = _livekit_token(room_id, player_id, room["players"][player_id]["player_name"])

    return RoomStateResponse(
        room_id=room_id,
        session_id=active_session_id,
        difficulty=session["difficulty"],
        length=len(session["word"]),
        guesses=session["guesses"],
        results=session["results"],
        current_guess=session.get("current_guess", ""),
        input_version=session.get("input_version", 0),
        game_over=session["game_over"],
        won=session["won"],
        answer=session["word"] if session["game_over"] else None,
        answer_info=_answer_info_for_session(session),
        hints_used=session.get("hints_used", 0),
        hints=session.get("hints", []),
        players=list(room["players"].values()),
        livekit=livekit,
        host_player_id=room.get("host_player_id"),
        active_board=active_board,
        shared_board=_board_state(shared_session_id),
        individual_board=_board_state(individual_session_id),
        share_request=room.get("share_request"),
        chat_messages=room.get("chat_messages", []),
        max_players=MAX_ROOM_PLAYERS,
        typing_player_id=session.get("typing_player_id"),
        typing_player_name=session.get("typing_player_name"),
        typing_player_emoji=session.get("typing_player_emoji"),
    )

def _require_room_player(room_id: str, player_id: str) -> dict[str, Any]:
    _cleanup_idle_rooms()
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    if player_id not in rooms[room_id]["players"]:
        raise HTTPException(status_code=403, detail="Player is not in this room")
    return rooms[room_id]

def _active_session_id(room: dict[str, Any], player_id: str) -> str:
    if player_id not in room["player_sessions"]:
        room["player_sessions"][player_id] = _create_session(room.get("difficulty", "easy"))
        _mark_session_leaderboard_context(room["player_sessions"][player_id], "party", False)

    active_board = room["player_active_boards"].get(player_id, "shared")
    if active_board == "individual":
        return room["player_sessions"][player_id]
    return room["active_shared_session_id"] or room["player_sessions"][player_id]

def _remember_room_leaderboard_player(room: dict[str, Any], player_id: str, leaderboard_user_id: str | None, leaderboard_token: str | None) -> None:
    if not leaderboard_user_id or not leaderboard_token or player_id not in room.get("players", {}):
        return
    room["players"][player_id]["leaderboard_user_id"] = leaderboard_user_id
    room["players"][player_id]["leaderboard_token"] = leaderboard_token

def _mark_session_participant(session_id: str, leaderboard_user_id: str | None, leaderboard_token: str | None) -> None:
    if not leaderboard_user_id or not leaderboard_token or session_id not in sessions:
        return
    sessions[session_id].setdefault("leaderboard_participants", {})[leaderboard_user_id] = leaderboard_token

def _mark_session_leaderboard_context(session_id: str, mode: str, shared_board: bool = False) -> None:
    if session_id not in sessions:
        return
    sessions[session_id]["leaderboard_mode"] = mode
    sessions[session_id]["leaderboard_shared_board"] = shared_board

def _record_session_results(session_id: str, only_user_id: str | None = None, only_token: str | None = None) -> None:
    if session_id not in sessions:
        return
    session = sessions[session_id]
    if not session.get("game_over"):
        return
    participants = dict(session.get("leaderboard_participants", {}))
    if only_user_id and only_token:
        participants[only_user_id] = only_token
    for leaderboard_user_id, token in participants.items():
        record_result(
            session_id=session_id,
            user_id=leaderboard_user_id,
            token=token,
            difficulty=session["difficulty"],
            won=bool(session.get("won")),
            guesses=len(session.get("guesses", [])),
            hints_used=int(session.get("hints_used", 0)),
            mode=session.get("leaderboard_mode", "solo"),
            shared_board=bool(session.get("leaderboard_shared_board")),
        )

def _submit_guess_to_session(session_id: str, guess: str) -> GuessResponse:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]
    target_word = session["word"]
    guess = guess.upper()

    if session.get("game_over"):
        raise HTTPException(status_code=409, detail="Game already finished")

    if guess in session["guesses"]:
        raise HTTPException(status_code=409, detail="Duplicate guess")

    if len(guess) != len(target_word):
        raise HTTPException(status_code=400, detail="Invalid guess length")

    if not guess.isalpha() or guess not in VALID_GUESSES:
        raise HTTPException(status_code=422, detail="Not in word list")

    states = _evaluate_guess(target_word, guess)
    session["guesses"].append(guess)
    session["results"].append(states)
    session["current_guess"] = ""
    session["input_version"] = session.get("input_version", 0) + 1
    session["typing_player_id"] = None
    session["typing_player_name"] = None
    session["typing_player_emoji"] = None

    won = states.count("correct") == len(target_word)
    max_guesses = 4 if session["difficulty"] == "prodigy" else 6
    game_over = won or len(session["guesses"]) >= max_guesses
    session["won"] = won
    session["game_over"] = game_over

    return GuessResponse(
        states=states,
        game_over=game_over,
        won=won,
        answer=target_word if game_over else None,
        answer_info=get_word_metadata(target_word) if game_over else None,
        hints_used=session.get("hints_used", 0),
    )

@app.get("/word", response_model=GameCreateResponse)
def create_game(difficulty: str = "easy", leaderboard_user_id: str | None = None, leaderboard_token: str | None = None):
    session_id = _create_session(difficulty)
    _mark_session_participant(session_id, leaderboard_user_id, leaderboard_token)
    return GameCreateResponse(session_id=session_id, length=len(sessions[session_id]["word"]))

@app.get("/daily-word", response_model=GameCreateResponse)
def create_daily_game(leaderboard_user_id: str | None = None, leaderboard_token: str | None = None):
    date_key = datetime.now(timezone.utc).date().isoformat()
    session_id = _create_session("easy", word=_daily_word_for(date_key), daily_date=date_key)
    _mark_session_participant(session_id, leaderboard_user_id, leaderboard_token)
    _mark_session_leaderboard_context(session_id, "daily", False)
    return GameCreateResponse(session_id=session_id, length=len(sessions[session_id]["word"]), daily_date=date_key)

@app.get("/sessions/{session_id}", response_model=BoardState)
def get_session_state(session_id: str):
    board = _board_state(session_id)
    if not board:
        raise HTTPException(status_code=404, detail="Session not found")
    return board

@app.post("/guess", response_model=GuessResponse)
def submit_guess(req: GuessRequest):
    _mark_session_participant(req.session_id, req.leaderboard_user_id, req.leaderboard_token)
    response = _submit_guess_to_session(req.session_id, req.guess)
    if response.game_over:
        _record_session_results(req.session_id, req.leaderboard_user_id, req.leaderboard_token)
    return response

@app.post("/rooms", response_model=RoomJoinResponse)
def create_room(req: RoomCreateRequest):
    _cleanup_idle_rooms()
    if not req.player_name.strip():
        raise HTTPException(status_code=400, detail="Player name is required")
    room_id = _room_code()
    player_id = req.player_id or str(uuid.uuid4())
    player_name = _clean_player_name(req.player_name)
    player_emoji = _clean_player_emoji(req.player_emoji)
    shared_session_id = _create_session(req.difficulty)
    individual_session_id = _create_session(req.difficulty)
    _mark_session_leaderboard_context(shared_session_id, "party", True)
    _mark_session_leaderboard_context(individual_session_id, "party", False)
    rooms[room_id] = {
        "room_id": room_id,
        "host_player_id": player_id,
        "voice_room_id": room_id,
        "difficulty": req.difficulty,
        "active_shared_session_id": shared_session_id,
        "player_sessions": {player_id: individual_session_id},
        "player_active_boards": {player_id: "shared"},
        "share_request": None,
        "chat_messages": [],
        "created_at": _now_iso(),
        "players": {
            player_id: {
                "player_id": player_id,
                "player_name": player_name,
                "player_emoji": player_emoji,
                "leaderboard_user_id": req.leaderboard_user_id,
                "leaderboard_token": req.leaderboard_token,
                "joined_at": _now_iso(),
                "last_active_at": _now_iso(),
            }
        },
        "last_active_at": _now_iso(),
    }
    state = _room_state(room_id, player_id)
    return RoomJoinResponse(**state.model_dump(), player_id=player_id)

@app.post("/rooms/{room_id}/join", response_model=RoomJoinResponse)
def join_room(room_id: str, req: RoomJoinRequest):
    _cleanup_idle_rooms()
    if not req.player_name.strip():
        raise HTTPException(status_code=400, detail="Player name is required")
    room_id = room_id.strip().upper()
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")

    player_id = req.player_id or str(uuid.uuid4())
    if player_id not in rooms[room_id]["players"] and len(rooms[room_id]["players"]) >= MAX_ROOM_PLAYERS:
        raise HTTPException(status_code=409, detail="Room is full")
    if player_id not in rooms[room_id]["player_sessions"]:
        rooms[room_id]["player_sessions"][player_id] = _create_session(rooms[room_id].get("difficulty", "easy"))
        _mark_session_leaderboard_context(rooms[room_id]["player_sessions"][player_id], "party", False)
    rooms[room_id]["player_active_boards"].setdefault(player_id, "shared")
    rooms[room_id]["players"][player_id] = {
        "player_id": player_id,
        "player_name": _clean_player_name(req.player_name),
        "player_emoji": _clean_player_emoji(req.player_emoji),
        "leaderboard_user_id": req.leaderboard_user_id or rooms[room_id]["players"].get(player_id, {}).get("leaderboard_user_id"),
        "leaderboard_token": req.leaderboard_token or rooms[room_id]["players"].get(player_id, {}).get("leaderboard_token"),
        "joined_at": rooms[room_id]["players"].get(player_id, {}).get("joined_at", _now_iso()),
        "last_active_at": _now_iso(),
    }
    _touch_room(rooms[room_id], player_id)
    state = _room_state(room_id, player_id)
    return RoomJoinResponse(**state.model_dump(), player_id=player_id)

@app.get("/rooms/{room_id}", response_model=RoomStateResponse)
def get_room_state(room_id: str, player_id: str | None = None):
    return _room_state(room_id.strip().upper(), player_id)

@app.post("/rooms/{room_id}/guess", response_model=RoomStateResponse)
def submit_room_guess(room_id: str, req: RoomGuessRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)

    _remember_room_leaderboard_player(room, req.player_id, req.leaderboard_user_id, req.leaderboard_token)
    session_id = _active_session_id(room, req.player_id)
    player = room["players"][req.player_id]
    _mark_session_participant(session_id, player.get("leaderboard_user_id"), player.get("leaderboard_token"))
    response = _submit_guess_to_session(session_id, req.guess)
    if response.game_over:
        _record_session_results(session_id)
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/input", response_model=RoomStateResponse)
def update_room_input(room_id: str, req: RoomInputRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)

    session = sessions[_active_session_id(room, req.player_id)]
    guess = req.current_guess.upper()
    if len(guess) > len(session["word"]) or (guess and not guess.isalpha()):
        raise HTTPException(status_code=400, detail="Invalid current guess")

    if not session.get("game_over"):
        player = room["players"][req.player_id]
        _mark_session_participant(
            _active_session_id(room, req.player_id),
            player.get("leaderboard_user_id"),
            player.get("leaderboard_token"),
        )
        session["current_guess"] = guess
        server_version = session.get("input_version", 0) + 1
        if req.client_input_version is not None:
            server_version = max(server_version, req.client_input_version)
        session["input_version"] = server_version
        if guess:
            session["typing_player_id"] = req.player_id
            session["typing_player_name"] = room["players"][req.player_id]["player_name"]
            session["typing_player_emoji"] = room["players"][req.player_id].get("player_emoji", "🙂")
        else:
            session["typing_player_id"] = None
            session["typing_player_name"] = None
            session["typing_player_emoji"] = None
        _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/shared-game", response_model=RoomStateResponse)
def create_shared_game(room_id: str, req: PlayerRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id or "")
    difficulty = room.get("difficulty", "easy")
    room["active_shared_session_id"] = _create_session(difficulty)
    _mark_session_leaderboard_context(room["active_shared_session_id"], "party", True)
    room["share_request"] = None
    for player_id in room["players"]:
        room["player_active_boards"][player_id] = "shared"
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/individual-game", response_model=RoomStateResponse)
def create_individual_game(room_id: str, req: PlayerRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id or "")
    difficulty = room.get("difficulty", "easy")
    room["player_sessions"][req.player_id] = _create_session(difficulty)
    _mark_session_leaderboard_context(room["player_sessions"][req.player_id], "party", False)
    room["player_active_boards"][req.player_id] = "individual"
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/difficulty", response_model=RoomStateResponse)
def change_room_difficulty(room_id: str, req: RoomDifficultyRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)
    difficulty = req.difficulty.strip().lower()
    room["difficulty"] = difficulty
    room["active_shared_session_id"] = _create_session(difficulty)
    _mark_session_leaderboard_context(room["active_shared_session_id"], "party", True)
    room["share_request"] = None
    for player_id in room["players"]:
        room["player_sessions"][player_id] = _create_session(difficulty)
        _mark_session_leaderboard_context(room["player_sessions"][player_id], "party", False)
        room["player_active_boards"][player_id] = "shared"
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/active-board", response_model=RoomStateResponse)
def set_active_board(room_id: str, req: ActiveBoardRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)
    if req.board not in {"shared", "individual"}:
        raise HTTPException(status_code=400, detail="Board must be shared or individual")
    if req.board == "shared" and not room.get("active_shared_session_id"):
        room["active_shared_session_id"] = _create_session(room.get("difficulty", "easy"))
        _mark_session_leaderboard_context(room["active_shared_session_id"], "party", True)
    if req.board == "individual" and req.player_id not in room["player_sessions"]:
        room["player_sessions"][req.player_id] = _create_session(room.get("difficulty", "easy"))
        _mark_session_leaderboard_context(room["player_sessions"][req.player_id], "party", False)
    room["player_active_boards"][req.player_id] = req.board
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/share-request", response_model=RoomStateResponse)
def create_share_request(room_id: str, req: ShareRequestCreate):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)
    if req.player_id not in room["player_sessions"]:
        room["player_sessions"][req.player_id] = _create_session(room.get("difficulty", "easy"))
        _mark_session_leaderboard_context(room["player_sessions"][req.player_id], "party", False)
    room["share_request"] = ShareRequestState(
        from_player_id=req.player_id,
        from_player_name=room["players"][req.player_id]["player_name"],
        session_id=room["player_sessions"][req.player_id],
        created_at=_now_iso(),
    )
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/share-request/respond", response_model=RoomStateResponse)
def respond_share_request(room_id: str, req: ShareRequestRespond):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)
    share_request = room.get("share_request")
    if not share_request:
        return _room_state(room_id, req.player_id)

    if req.accept:
        room["active_shared_session_id"] = share_request.session_id
        _mark_session_leaderboard_context(room["active_shared_session_id"], "party", True)
        for player_id in room["players"]:
            room["player_active_boards"][player_id] = "shared"
    room["share_request"] = None
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.post("/rooms/{room_id}/chat", response_model=RoomStateResponse)
def send_room_chat(room_id: str, req: RoomChatRequest):
    room_id = room_id.strip().upper()
    room = _require_room_player(room_id, req.player_id)
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")
    if len(text) > 180:
        raise HTTPException(status_code=400, detail="Message is too long")

    player = room["players"][req.player_id]
    message = ChatMessage(
        message_id=str(uuid.uuid4()),
        player_id=req.player_id,
        player_name=player["player_name"],
        player_emoji=player.get("player_emoji", "🙂"),
        text=text,
        created_at=_now_iso(),
    )
    room.setdefault("chat_messages", []).append(message.model_dump())
    room["chat_messages"] = room["chat_messages"][-50:]
    _touch_room(room, req.player_id)
    return _room_state(room_id, req.player_id)

@app.get("/hint", response_model=HintResponse)
def get_hint(session_id: str, level: int = 1):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    if level not in {1, 2}:
        raise HTTPException(status_code=400, detail="Only two hints are available")

    session = sessions[session_id]
    if session.get("game_over"):
        raise HTTPException(status_code=409, detail="Puzzle already finished")
    if session.get("hints_used", 0) >= 2:
        raise HTTPException(status_code=409, detail="No hints left")

    info = get_word_metadata(session["word"]) or {}
    if level == 1:
        payload = {
            "hint": _human_meaning_hint(session["word"], info),
            "kind": "meaning",
        }
    else:
        payload = _letter_hint_for_session(session)

    session["hints_used"] = session.get("hints_used", 0) + 1
    session["hint_assisted"] = True
    hint_entry = {"level": level, "text": payload["hint"], **payload}
    session.setdefault("hints", []).append(hint_entry)
    return HintResponse(
        hint=payload["hint"],
        level=level,
        hints_used=session["hints_used"],
        kind=payload["kind"],
        revealed_position=payload.get("revealed_position"),
        revealed_letter=payload.get("revealed_letter"),
    )
