from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import hashlib
import os
import re
import secrets
import sqlite3
import uuid

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # Local fallback works without Postgres dependencies.
    psycopg = None
    dict_row = None


DATABASE_URL = os.getenv("DATABASE_URL", "")
SQLITE_PATH = Path(__file__).resolve().parent / "leaderboard.db"
SCOPES = ("overall", "easy", "moderate", "difficult", "prodigy")
DIFFICULTY_POINTS = {"easy": 100, "moderate": 140, "difficult": 180, "prodigy": 250}
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,16}$")


def _using_postgres() -> bool:
    return bool(DATABASE_URL and DATABASE_URL.startswith(("postgres://", "postgresql://")) and psycopg)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_username(username: str) -> str:
    return username.strip().lower()


def validate_username(username: str) -> str:
    normalized = normalize_username(username)
    if not USERNAME_PATTERN.match(normalized):
        raise ValueError("Username must be 3-16 letters, numbers, or underscores")
    return normalized


@contextmanager
def _conn():
    if _using_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            yield conn
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def _execute(conn, sql: str, params: tuple[Any, ...] = ()):
    if _using_postgres():
        sql = sql.replace("?", "%s")
    return conn.execute(sql, params)


def _row_to_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def init_db() -> None:
    with _conn() as conn:
        if _using_postgres():
            _execute(conn, """
                CREATE TABLE IF NOT EXISTS players (
                    user_id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    emoji TEXT NOT NULL DEFAULT '🙂',
                    token_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            _execute(conn, """
                CREATE TABLE IF NOT EXISTS player_stats (
                    user_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    score INTEGER NOT NULL DEFAULT 0,
                    games_played INTEGER NOT NULL DEFAULT 0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    current_streak INTEGER NOT NULL DEFAULT 0,
                    max_streak INTEGER NOT NULL DEFAULT 0,
                    total_guesses INTEGER NOT NULL DEFAULT 0,
                    hint_games INTEGER NOT NULL DEFAULT 0,
                    hint_wins INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, scope),
                    FOREIGN KEY (user_id) REFERENCES players(user_id)
                )
            """)
            _execute(conn, """
                CREATE TABLE IF NOT EXISTS game_results (
                    session_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    difficulty TEXT NOT NULL,
                    won BOOLEAN NOT NULL,
                    score_delta INTEGER NOT NULL,
                    guesses INTEGER NOT NULL,
                    hints_used INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, user_id, scope)
                )
            """)
        else:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS players (
                    user_id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    emoji TEXT NOT NULL DEFAULT '🙂',
                    token_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS player_stats (
                    user_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    score INTEGER NOT NULL DEFAULT 0,
                    games_played INTEGER NOT NULL DEFAULT 0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    current_streak INTEGER NOT NULL DEFAULT 0,
                    max_streak INTEGER NOT NULL DEFAULT 0,
                    total_guesses INTEGER NOT NULL DEFAULT 0,
                    hint_games INTEGER NOT NULL DEFAULT 0,
                    hint_wins INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, scope),
                    FOREIGN KEY (user_id) REFERENCES players(user_id)
                );
                CREATE TABLE IF NOT EXISTS game_results (
                    session_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    difficulty TEXT NOT NULL,
                    won INTEGER NOT NULL,
                    score_delta INTEGER NOT NULL,
                    guesses INTEGER NOT NULL,
                    hints_used INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, user_id, scope)
                );
            """)


def username_available(username: str) -> bool:
    normalized = validate_username(username)
    with _conn() as conn:
        row = _execute(conn, "SELECT user_id FROM players WHERE username = ?", (normalized,)).fetchone()
        return row is None


def register_player(username: str, emoji: str = "🙂", user_id: str | None = None, token: str | None = None) -> dict[str, str]:
    normalized = validate_username(username)
    emoji = (emoji or "🙂").strip()[:4] or "🙂"
    now = _now_iso()
    token = token or secrets.token_urlsafe(32)
    token_hash = _hash_token(token)

    with _conn() as conn:
        existing = _row_to_dict(_execute(conn, "SELECT * FROM players WHERE username = ?", (normalized,)).fetchone())
        if existing:
            if user_id == existing["user_id"] and token and _hash_token(token) == existing["token_hash"]:
                _execute(conn, "UPDATE players SET emoji = ?, updated_at = ? WHERE user_id = ?", (emoji, now, user_id))
                return {"user_id": user_id, "username": normalized, "emoji": emoji, "leaderboard_token": token}
            raise ValueError("Username is already taken")

        user_id = user_id or str(uuid.uuid4())
        _execute(
            conn,
            "INSERT INTO players (user_id, username, emoji, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, normalized, emoji, token_hash, now, now),
        )
        for scope in SCOPES:
            _execute(conn, "INSERT INTO player_stats (user_id, scope, updated_at) VALUES (?, ?, ?)", (user_id, scope, now))
        return {"user_id": user_id, "username": normalized, "emoji": emoji, "leaderboard_token": token}


def verify_player(user_id: str | None, token: str | None) -> dict[str, Any] | None:
    if not user_id or not token:
        return None
    with _conn() as conn:
        player = _row_to_dict(_execute(conn, "SELECT * FROM players WHERE user_id = ?", (user_id,)).fetchone())
    if not player or player["token_hash"] != _hash_token(token):
        return None
    return player


def score_for_game(difficulty: str, won: bool, guesses: int, hints_used: int) -> int:
    if not won:
        return 0
    max_guesses = 4 if difficulty == "prodigy" else 6
    remaining = max(max_guesses - guesses, 0)
    return max(DIFFICULTY_POINTS.get(difficulty, 100) + (10 * remaining) + (15 if hints_used == 0 else 0) - (10 * hints_used), 0)


def record_result(session_id: str, user_id: str | None, token: str | None, difficulty: str, won: bool, guesses: int, hints_used: int) -> bool:
    player = verify_player(user_id, token)
    if not player:
        return False

    now = _now_iso()
    difficulty = difficulty if difficulty in DIFFICULTY_POINTS else "easy"
    score_delta = score_for_game(difficulty, won, guesses, hints_used)
    scopes = ("overall", difficulty)

    with _conn() as conn:
        for scope in scopes:
            try:
                _execute(
                    conn,
                    "INSERT INTO game_results (session_id, user_id, scope, difficulty, won, score_delta, guesses, hints_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (session_id, user_id, scope, difficulty, bool(won), score_delta, guesses, hints_used, now),
                )
            except Exception:
                continue

            current = _row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = ?", (user_id, scope)).fetchone())
            if not current:
                _execute(conn, "INSERT INTO player_stats (user_id, scope, updated_at) VALUES (?, ?, ?)", (user_id, scope, now))
                current = {"current_streak": 0, "max_streak": 0}
            next_streak = int(current.get("current_streak") or 0) + 1 if won else 0
            next_max = max(int(current.get("max_streak") or 0), next_streak)
            _execute(
                conn,
                """
                UPDATE player_stats
                SET score = score + ?,
                    games_played = games_played + 1,
                    wins = wins + ?,
                    losses = losses + ?,
                    current_streak = ?,
                    max_streak = ?,
                    total_guesses = total_guesses + ?,
                    hint_games = hint_games + ?,
                    hint_wins = hint_wins + ?,
                    updated_at = ?
                WHERE user_id = ? AND scope = ?
                """,
                (
                    score_delta,
                    1 if won else 0,
                    0 if won else 1,
                    next_streak,
                    next_max,
                    guesses if won else 0,
                    1 if hints_used > 0 else 0,
                    1 if won and hints_used > 0 else 0,
                    now,
                    user_id,
                    scope,
                ),
            )
    return True


def leaderboard(scope: str = "overall", limit: int = 50, user_id: str | None = None) -> dict[str, Any]:
    scope = scope if scope in SCOPES else "overall"
    limit = min(max(limit, 1), 100)
    order = "s.score DESC, s.wins DESC, s.max_streak DESC, CASE WHEN s.wins > 0 THEN CAST(s.total_guesses AS REAL) / s.wins ELSE 999 END ASC, s.updated_at DESC"
    with _conn() as conn:
        rows = [
            _row_to_dict(row)
            for row in _execute(
                conn,
                f"""
                SELECT p.user_id, p.username, p.emoji, s.scope, s.score, s.games_played, s.wins, s.losses,
                       s.current_streak, s.max_streak, s.total_guesses, s.hint_games, s.hint_wins, s.updated_at
                FROM player_stats s
                JOIN players p ON p.user_id = s.user_id
                WHERE s.scope = ? AND s.games_played > 0
                ORDER BY {order}
                LIMIT ?
                """,
                (scope, limit),
            ).fetchall()
        ]
        all_rows = [
            _row_to_dict(row)
            for row in _execute(
                conn,
                f"""
                SELECT p.user_id, p.username, p.emoji, s.scope, s.score, s.games_played, s.wins, s.losses,
                       s.current_streak, s.max_streak, s.total_guesses, s.hint_games, s.hint_wins, s.updated_at
                FROM player_stats s
                JOIN players p ON p.user_id = s.user_id
                WHERE s.scope = ? AND s.games_played > 0
                ORDER BY {order}
                """,
                (scope,),
            ).fetchall()
        ]

    def decorate(row: dict[str, Any], rank: int) -> dict[str, Any]:
        wins = int(row.get("wins") or 0)
        games = int(row.get("games_played") or 0)
        avg = round((int(row.get("total_guesses") or 0) / wins), 2) if wins else None
        return {
            "rank": rank,
            "user_id": row["user_id"],
            "username": row["username"],
            "emoji": row.get("emoji") or "🙂",
            "score": int(row.get("score") or 0),
            "games_played": games,
            "wins": wins,
            "losses": int(row.get("losses") or 0),
            "win_rate": round((wins / games) * 100) if games else 0,
            "current_streak": int(row.get("current_streak") or 0),
            "max_streak": int(row.get("max_streak") or 0),
            "avg_guesses": avg,
            "hint_games": int(row.get("hint_games") or 0),
            "hint_wins": int(row.get("hint_wins") or 0),
        }

    decorated = [decorate(row, index + 1) for index, row in enumerate(rows)]
    current_user = None
    if user_id:
        for index, row in enumerate(all_rows):
            if row["user_id"] == user_id:
                current_user = decorate(row, index + 1)
                break
    return {"scope": scope, "entries": decorated, "current_user": current_user}
