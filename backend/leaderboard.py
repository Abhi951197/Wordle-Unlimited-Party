from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
ALL_TIME_KEY = "all"
PERIOD_TYPES = ("weekly", "all_time")

ACHIEVEMENTS = [
    {"id": "first_win", "title": "First Win", "description": "Win your first puzzle.", "icon": "🏆", "target": 1},
    {"id": "sharp_solver", "title": "Sharp Solver", "description": "Win in 3 guesses or fewer.", "icon": "🎯", "target": 1},
    {"id": "no_hint_victory", "title": "No-Hint Victory", "description": "Win without using hints.", "icon": "✨", "target": 1},
    {"id": "streak_3", "title": "Streak 3", "description": "Win 3 games in a row.", "icon": "🔥", "target": 3},
    {"id": "streak_10", "title": "Streak 10", "description": "Win 10 games in a row.", "icon": "⚡", "target": 10},
    {"id": "easy_specialist", "title": "Easy Specialist", "description": "Win 10 Easy games.", "icon": "🟢", "target": 10},
    {"id": "moderate_master", "title": "Moderate Master", "description": "Win 10 Moderate games.", "icon": "🟡", "target": 10},
    {"id": "difficult_dominator", "title": "Difficult Dominator", "description": "Win 10 Difficult games.", "icon": "🔴", "target": 10},
    {"id": "prodigy_solver", "title": "Prodigy Solver", "description": "Win 5 Prodigy games.", "icon": "🟣", "target": 5},
    {"id": "party_player", "title": "Party Player", "description": "Complete 5 party games.", "icon": "🎉", "target": 5},
    {"id": "team_solver", "title": "Team Solver", "description": "Win a shared party board.", "icon": "🤝", "target": 1},
    {"id": "weekly_top_10", "title": "Weekly Top 10", "description": "Finish a week in the top 10.", "icon": "⭐", "target": 1},
    {"id": "weekly_champion", "title": "Weekly Champion", "description": "Finish a week ranked #1.", "icon": "👑", "target": 1},
]


def _using_postgres() -> bool:
    return bool(DATABASE_URL and DATABASE_URL.startswith(("postgres://", "postgresql://")) and psycopg)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _week_bounds(moment: datetime | None = None) -> tuple[str, datetime, datetime]:
    moment = moment or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(timezone.utc)
    iso = moment.isocalendar()
    start = moment - timedelta(days=iso.weekday - 1, hours=moment.hour, minutes=moment.minute, seconds=moment.second, microseconds=moment.microsecond)
    end = start + timedelta(days=7)
    return f"{iso.year}-W{iso.week:02d}", start, end


def _week_bounds_from_key(period_key: str) -> tuple[str, datetime, datetime]:
    if period_key == "current":
        return _week_bounds()
    match = re.match(r"^(\d{4})-W(\d{2})$", period_key or "")
    if not match:
        return _week_bounds()
    year, week = int(match.group(1)), int(match.group(2))
    start = datetime.fromisocalendar(year, week, 1).replace(tzinfo=timezone.utc)
    return f"{year}-W{week:02d}", start, start + timedelta(days=7)


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


def _table_columns(conn, table: str) -> set[str]:
    if _using_postgres():
        rows = _execute(conn, "SELECT column_name FROM information_schema.columns WHERE table_name = ?", (table,)).fetchall()
        return {row["column_name"] if isinstance(row, dict) else row[0] for row in rows}
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column(conn, table: str, column: str, definition: str) -> None:
    if column not in _table_columns(conn, table):
        _execute(conn, f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


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
        for index in range(1, 7):
            _add_column(conn, "player_stats", f"guess_{index}", "INTEGER NOT NULL DEFAULT 0")
        _add_column(conn, "game_results", "mode", "TEXT NOT NULL DEFAULT 'solo'")
        _add_column(conn, "game_results", "shared_board", "INTEGER NOT NULL DEFAULT 0")
        _execute(conn, """
            CREATE TABLE IF NOT EXISTS player_period_stats (
                user_id TEXT NOT NULL,
                scope TEXT NOT NULL,
                period_type TEXT NOT NULL,
                period_key TEXT NOT NULL,
                score INTEGER NOT NULL DEFAULT 0,
                games_played INTEGER NOT NULL DEFAULT 0,
                wins INTEGER NOT NULL DEFAULT 0,
                losses INTEGER NOT NULL DEFAULT 0,
                current_streak INTEGER NOT NULL DEFAULT 0,
                max_streak INTEGER NOT NULL DEFAULT 0,
                total_guesses INTEGER NOT NULL DEFAULT 0,
                hint_games INTEGER NOT NULL DEFAULT 0,
                hint_wins INTEGER NOT NULL DEFAULT 0,
                guess_1 INTEGER NOT NULL DEFAULT 0,
                guess_2 INTEGER NOT NULL DEFAULT 0,
                guess_3 INTEGER NOT NULL DEFAULT 0,
                guess_4 INTEGER NOT NULL DEFAULT 0,
                guess_5 INTEGER NOT NULL DEFAULT 0,
                guess_6 INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, scope, period_type, period_key),
                FOREIGN KEY (user_id) REFERENCES players(user_id)
            )
        """)
        _execute(conn, """
            CREATE TABLE IF NOT EXISTS player_achievements (
                user_id TEXT NOT NULL,
                achievement_id TEXT NOT NULL,
                period_key TEXT NOT NULL DEFAULT '',
                unlocked_at TEXT NOT NULL,
                PRIMARY KEY (user_id, achievement_id, period_key),
                FOREIGN KEY (user_id) REFERENCES players(user_id)
            )
        """)
        _backfill_stats_from_results(conn)
        _repair_leaderboard_stats(conn)


def _backfill_stats_from_results(conn) -> None:
    _execute(conn, "DELETE FROM player_period_stats")
    rows = [_row_to_dict(row) for row in _execute(
        conn,
        "SELECT * FROM game_results ORDER BY created_at ASC",
    ).fetchall()]
    for row in rows:
        if not row:
            continue
        created_at = row.get("created_at") or _now_iso()
        week_key, _, _ = _week_bounds(_parse_iso(created_at))
        won = bool(row.get("won"))
        _update_period_stats(
            conn,
            row["user_id"],
            row["scope"],
            "all_time",
            ALL_TIME_KEY,
            int(row.get("score_delta") or 0),
            won,
            int(row.get("guesses") or 0),
            int(row.get("hints_used") or 0),
            created_at,
        )
        _update_period_stats(
            conn,
            row["user_id"],
            row["scope"],
            "weekly",
            week_key,
            int(row.get("score_delta") or 0),
            won,
            int(row.get("guesses") or 0),
            int(row.get("hints_used") or 0),
            created_at,
        )

    stat_rows = [_row_to_dict(row) for row in _execute(conn, "SELECT * FROM player_stats WHERE wins > 0").fetchall()]
    for stat in stat_rows:
        if not stat:
            continue
        counts = [0, 0, 0, 0, 0, 0]
        results = [_row_to_dict(row) for row in _execute(
            conn,
            "SELECT guesses FROM game_results WHERE user_id = ? AND scope = ? AND won = ?",
            (stat["user_id"], stat["scope"], True),
        ).fetchall()]
        for result in results:
            guesses = max(1, min(int((result or {}).get("guesses") or 0), 6))
            counts[guesses - 1] += 1
        _execute(
            conn,
            """
            UPDATE player_stats
            SET guess_1 = ?, guess_2 = ?, guess_3 = ?, guess_4 = ?, guess_5 = ?, guess_6 = ?
            WHERE user_id = ? AND scope = ?
            """,
            (*counts, stat["user_id"], stat["scope"]),
        )


def _copy_period_row_to_player_stats(conn, row: dict[str, Any]) -> None:
    _execute(
        conn,
        """
        UPDATE player_stats
        SET score = ?, games_played = ?, wins = ?, losses = ?, current_streak = ?, max_streak = ?,
            total_guesses = ?, hint_games = ?, hint_wins = ?,
            guess_1 = ?, guess_2 = ?, guess_3 = ?, guess_4 = ?, guess_5 = ?, guess_6 = ?, updated_at = ?
        WHERE user_id = ? AND scope = ?
        """,
        (
            int(row.get("score") or 0),
            int(row.get("games_played") or 0),
            int(row.get("wins") or 0),
            int(row.get("losses") or 0),
            int(row.get("current_streak") or 0),
            int(row.get("max_streak") or 0),
            int(row.get("total_guesses") or 0),
            int(row.get("hint_games") or 0),
            int(row.get("hint_wins") or 0),
            int(row.get("guess_1") or 0),
            int(row.get("guess_2") or 0),
            int(row.get("guess_3") or 0),
            int(row.get("guess_4") or 0),
            int(row.get("guess_5") or 0),
            int(row.get("guess_6") or 0),
            row.get("updated_at") or _now_iso(),
            row["user_id"],
            row["scope"],
        ),
    )


def _upsert_all_time_period_from_player_stats(conn, row: dict[str, Any]) -> None:
    existing = _row_to_dict(_execute(
        conn,
        "SELECT * FROM player_period_stats WHERE user_id = ? AND scope = ? AND period_type = 'all_time' AND period_key = ?",
        (row["user_id"], row["scope"], ALL_TIME_KEY),
    ).fetchone())
    if existing and int(existing.get("games_played") or 0) >= int(row.get("games_played") or 0):
        return

    _execute(
        conn,
        """
        INSERT INTO player_period_stats (
            user_id, scope, period_type, period_key, score, games_played, wins, losses,
            current_streak, max_streak, total_guesses, hint_games, hint_wins,
            guess_1, guess_2, guess_3, guess_4, guess_5, guess_6, updated_at
        ) VALUES (?, ?, 'all_time', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, scope, period_type, period_key) DO UPDATE SET
            score = excluded.score,
            games_played = excluded.games_played,
            wins = excluded.wins,
            losses = excluded.losses,
            current_streak = excluded.current_streak,
            max_streak = excluded.max_streak,
            total_guesses = excluded.total_guesses,
            hint_games = excluded.hint_games,
            hint_wins = excluded.hint_wins,
            guess_1 = excluded.guess_1,
            guess_2 = excluded.guess_2,
            guess_3 = excluded.guess_3,
            guess_4 = excluded.guess_4,
            guess_5 = excluded.guess_5,
            guess_6 = excluded.guess_6,
            updated_at = excluded.updated_at
        """,
        (
            row["user_id"],
            row["scope"],
            ALL_TIME_KEY,
            int(row.get("score") or 0),
            int(row.get("games_played") or 0),
            int(row.get("wins") or 0),
            int(row.get("losses") or 0),
            int(row.get("current_streak") or 0),
            int(row.get("max_streak") or 0),
            int(row.get("total_guesses") or 0),
            int(row.get("hint_games") or 0),
            int(row.get("hint_wins") or 0),
            int(row.get("guess_1") or 0),
            int(row.get("guess_2") or 0),
            int(row.get("guess_3") or 0),
            int(row.get("guess_4") or 0),
            int(row.get("guess_5") or 0),
            int(row.get("guess_6") or 0),
            row.get("updated_at") or _now_iso(),
        ),
    )


def _repair_leaderboard_stats(conn) -> None:
    """Keep legacy all-time stats and period stats in sync across week rollovers."""
    now = _now_iso()
    for player in [_row_to_dict(row) for row in _execute(conn, "SELECT user_id FROM players").fetchall()]:
        if not player:
            continue
        for scope in SCOPES:
            _execute(
                conn,
                "INSERT INTO player_stats (user_id, scope, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id, scope) DO NOTHING",
                (player["user_id"], scope, now),
            )

    for row in [_row_to_dict(row) for row in _execute(conn, "SELECT * FROM player_stats WHERE games_played > 0").fetchall()]:
        if row:
            _upsert_all_time_period_from_player_stats(conn, row)

    for row in [_row_to_dict(row) for row in _execute(
        conn,
        "SELECT * FROM player_period_stats WHERE period_type = 'all_time' AND period_key = ? AND games_played > 0",
        (ALL_TIME_KEY,),
    ).fetchall()]:
        if not row:
            continue
        player_stat = _row_to_dict(_execute(
            conn,
            "SELECT * FROM player_stats WHERE user_id = ? AND scope = ?",
            (row["user_id"], row["scope"]),
        ).fetchone())
        if not player_stat or int(player_stat.get("games_played") or 0) < int(row.get("games_played") or 0):
            _copy_period_row_to_player_stats(conn, row)


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


def _score_from_distribution(scope: str, distribution: list[int], hint_wins: int = 0) -> int:
    difficulty = scope if scope in DIFFICULTY_POINTS else "easy"
    score = 0
    for index, count in enumerate((distribution or [])[:6]):
        guess_count = index + 1
        score += score_for_game(difficulty, True, guess_count, 0) * max(int(count or 0), 0)
    return max(score - (10 * max(int(hint_wins or 0), 0)), 0)


def _coerce_import_scope(scope: str, payload: dict[str, Any]) -> dict[str, Any]:
    distribution = payload.get("guess_distribution") if isinstance(payload.get("guess_distribution"), list) else []
    distribution = [max(int(value or 0), 0) for value in distribution[:6]]
    distribution = (distribution + [0, 0, 0, 0, 0, 0])[:6]
    wins = max(int(payload.get("wins") or sum(distribution)), sum(distribution))
    games_played = max(int(payload.get("games_played") or wins), wins)
    losses = max(int(payload.get("losses") or (games_played - wins)), 0)
    hint_games = max(int(payload.get("hint_games") or 0), 0)
    hint_wins = max(int(payload.get("hint_wins") or 0), 0)
    total_guesses = sum((index + 1) * count for index, count in enumerate(distribution))
    return {
        "scope": scope,
        "score": max(int(payload.get("score") or _score_from_distribution(scope, distribution, hint_wins)), 0),
        "games_played": games_played,
        "wins": wins,
        "losses": losses,
        "current_streak": max(int(payload.get("current_streak") or 0), 0),
        "max_streak": max(int(payload.get("max_streak") or 0), 0),
        "total_guesses": max(int(payload.get("total_guesses") or total_guesses), total_guesses),
        "hint_games": hint_games,
        "hint_wins": hint_wins,
        "guess_distribution": distribution,
    }


def import_player_stats(user_id: str | None, token: str | None, stats_by_scope: dict[str, Any]) -> bool:
    player = verify_player(user_id, token)
    if not player:
        return False

    now = _now_iso()
    prepared: dict[str, dict[str, Any]] = {}
    for scope in SCOPES:
        source = stats_by_scope.get(scope) if isinstance(stats_by_scope, dict) else None
        if isinstance(source, dict):
            prepared[scope] = _coerce_import_scope(scope, source)

    if "overall" not in prepared:
        return False

    if any(scope in prepared for scope in DIFFICULTY_POINTS):
        difficulty_rows = [prepared[scope] for scope in DIFFICULTY_POINTS if scope in prepared]
        summed = {
            "scope": "overall",
            "score": sum(row["score"] for row in difficulty_rows),
            "games_played": sum(row["games_played"] for row in difficulty_rows),
            "wins": sum(row["wins"] for row in difficulty_rows),
            "losses": sum(row["losses"] for row in difficulty_rows),
            "current_streak": prepared["overall"]["current_streak"],
            "max_streak": max(prepared["overall"]["max_streak"], max((row["max_streak"] for row in difficulty_rows), default=0)),
            "total_guesses": sum(row["total_guesses"] for row in difficulty_rows),
            "hint_games": sum(row["hint_games"] for row in difficulty_rows),
            "hint_wins": sum(row["hint_wins"] for row in difficulty_rows),
            "guess_distribution": [
                sum(row["guess_distribution"][index] for row in difficulty_rows)
                for index in range(6)
            ],
        }
        if summed["games_played"] >= prepared["overall"]["games_played"]:
            prepared["overall"] = summed

    with _conn() as conn:
        for scope, row in prepared.items():
            existing = _row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = ?", (user_id, scope)).fetchone())
            if existing and int(existing.get("games_played") or 0) >= int(row["games_played"]):
                continue
            _execute(
                conn,
                """
                INSERT INTO player_stats (
                    user_id, scope, score, games_played, wins, losses, current_streak, max_streak,
                    total_guesses, hint_games, hint_wins, guess_1, guess_2, guess_3, guess_4, guess_5, guess_6, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, scope) DO UPDATE SET
                    score = excluded.score,
                    games_played = excluded.games_played,
                    wins = excluded.wins,
                    losses = excluded.losses,
                    current_streak = excluded.current_streak,
                    max_streak = excluded.max_streak,
                    total_guesses = excluded.total_guesses,
                    hint_games = excluded.hint_games,
                    hint_wins = excluded.hint_wins,
                    guess_1 = excluded.guess_1,
                    guess_2 = excluded.guess_2,
                    guess_3 = excluded.guess_3,
                    guess_4 = excluded.guess_4,
                    guess_5 = excluded.guess_5,
                    guess_6 = excluded.guess_6,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    scope,
                    row["score"],
                    row["games_played"],
                    row["wins"],
                    row["losses"],
                    row["current_streak"],
                    row["max_streak"],
                    row["total_guesses"],
                    row["hint_games"],
                    row["hint_wins"],
                    *row["guess_distribution"],
                    now,
                ),
            )
        _repair_leaderboard_stats(conn)
    return True


def _stat_update_values(current: dict[str, Any] | None, won: bool, guesses: int, hints_used: int) -> tuple[int, int]:
    current = current or {}
    next_streak = int(current.get("current_streak") or 0) + 1 if won else 0
    next_max = max(int(current.get("max_streak") or 0), next_streak)
    return next_streak, next_max


def _update_player_stats(conn, user_id: str, scope: str, score_delta: int, won: bool, guesses: int, hints_used: int, now: str) -> None:
    current = _row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = ?", (user_id, scope)).fetchone())
    if not current:
        _execute(conn, "INSERT INTO player_stats (user_id, scope, updated_at) VALUES (?, ?, ?)", (user_id, scope, now))
        current = {}
    next_streak, next_max = _stat_update_values(current, won, guesses, hints_used)
    guess_column = f"guess_{max(1, min(guesses, 6))}" if won else None
    guess_sql = f", {guess_column} = {guess_column} + 1" if guess_column else ""
    _execute(
        conn,
        f"""
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
            {guess_sql}
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


def _update_period_stats(conn, user_id: str, scope: str, period_type: str, period_key: str, score_delta: int, won: bool, guesses: int, hints_used: int, now: str) -> None:
    current = _row_to_dict(_execute(
        conn,
        "SELECT * FROM player_period_stats WHERE user_id = ? AND scope = ? AND period_type = ? AND period_key = ?",
        (user_id, scope, period_type, period_key),
    ).fetchone())
    if not current:
        _execute(
            conn,
            "INSERT INTO player_period_stats (user_id, scope, period_type, period_key, updated_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, scope, period_type, period_key, now),
        )
        current = {}
    next_streak, next_max = _stat_update_values(current, won, guesses, hints_used)
    guess_column = f"guess_{max(1, min(guesses, 6))}" if won else None
    guess_sql = f", {guess_column} = {guess_column} + 1" if guess_column else ""
    _execute(
        conn,
        f"""
        UPDATE player_period_stats
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
            {guess_sql}
        WHERE user_id = ? AND scope = ? AND period_type = ? AND period_key = ?
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
            period_type,
            period_key,
        ),
    )


def _unlock(conn, user_id: str, achievement_id: str, now: str, period_key: str | None = None) -> None:
    try:
        _execute(
            conn,
            "INSERT INTO player_achievements (user_id, achievement_id, period_key, unlocked_at) VALUES (?, ?, ?, ?)",
            (user_id, achievement_id, period_key or "", now),
        )
    except Exception:
        pass


def _evaluate_achievements(conn, user_id: str, difficulty: str, won: bool, guesses: int, hints_used: int, mode: str, shared_board: bool, now: str) -> None:
    overall = _row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = 'overall'", (user_id,)).fetchone()) or {}
    if int(overall.get("wins") or 0) >= 1:
        _unlock(conn, user_id, "first_win", now)
    if won and guesses <= 3:
        _unlock(conn, user_id, "sharp_solver", now)
    if won and hints_used == 0:
        _unlock(conn, user_id, "no_hint_victory", now)
    if int(overall.get("current_streak") or 0) >= 3:
        _unlock(conn, user_id, "streak_3", now)
    if int(overall.get("current_streak") or 0) >= 10:
        _unlock(conn, user_id, "streak_10", now)
    difficulty_targets = {
        "easy": ("easy_specialist", 10),
        "moderate": ("moderate_master", 10),
        "difficult": ("difficult_dominator", 10),
        "prodigy": ("prodigy_solver", 5),
    }
    for scope, (achievement_id, target) in difficulty_targets.items():
        row = _row_to_dict(_execute(conn, "SELECT wins FROM player_stats WHERE user_id = ? AND scope = ?", (user_id, scope)).fetchone()) or {}
        if int(row.get("wins") or 0) >= target:
            _unlock(conn, user_id, achievement_id, now)
    party_games = _execute(conn, "SELECT COUNT(DISTINCT session_id) AS count FROM game_results WHERE user_id = ? AND scope = 'overall' AND mode = 'party'", (user_id,)).fetchone()
    if int((_row_to_dict(party_games) or {}).get("count") or 0) >= 5:
        _unlock(conn, user_id, "party_player", now)
    if won and mode == "party" and shared_board:
        _unlock(conn, user_id, "team_solver", now)


def record_result(session_id: str, user_id: str | None, token: str | None, difficulty: str, won: bool, guesses: int, hints_used: int, mode: str = "solo", shared_board: bool = False) -> bool:
    player = verify_player(user_id, token)
    if not player:
        return False

    now = _now_iso()
    week_key, _, _ = _week_bounds(_parse_iso(now))
    difficulty = difficulty if difficulty in DIFFICULTY_POINTS else "easy"
    score_delta = score_for_game(difficulty, won, guesses, hints_used)
    scopes = ("overall", difficulty)
    inserted_any = False

    with _conn() as conn:
        for scope in scopes:
            try:
                _execute(
                    conn,
                    "INSERT INTO game_results (session_id, user_id, scope, difficulty, won, score_delta, guesses, hints_used, created_at, mode, shared_board) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (session_id, user_id, scope, difficulty, bool(won), score_delta, guesses, hints_used, now, mode, 1 if shared_board else 0),
                )
            except Exception:
                continue

            inserted_any = True
            _update_player_stats(conn, user_id, scope, score_delta, won, guesses, hints_used, now)
            _update_period_stats(conn, user_id, scope, "all_time", ALL_TIME_KEY, score_delta, won, guesses, hints_used, now)
            _update_period_stats(conn, user_id, scope, "weekly", week_key, score_delta, won, guesses, hints_used, now)
        if inserted_any:
            _evaluate_achievements(conn, user_id, difficulty, won, guesses, hints_used, mode, shared_board, now)
    return inserted_any


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


def _empty_stats(scope: str) -> dict[str, Any]:
    return {
        "scope": scope,
        "score": 0,
        "games_played": 0,
        "wins": 0,
        "losses": 0,
        "win_rate": 0,
        "current_streak": 0,
        "max_streak": 0,
        "total_guesses": 0,
        "avg_guesses": None,
        "hint_games": 0,
        "hint_wins": 0,
        "guess_distribution": [0, 0, 0, 0, 0, 0],
    }


def _decorate_stats(row: dict[str, Any] | None, scope: str = "overall") -> dict[str, Any]:
    if not row:
        return _empty_stats(scope)
    wins = int(row.get("wins") or 0)
    games = int(row.get("games_played") or 0)
    total_guesses = int(row.get("total_guesses") or 0)
    return {
        "scope": row.get("scope") or scope,
        "score": int(row.get("score") or 0),
        "games_played": games,
        "wins": wins,
        "losses": int(row.get("losses") or 0),
        "win_rate": round((wins / games) * 100) if games else 0,
        "current_streak": int(row.get("current_streak") or 0),
        "max_streak": int(row.get("max_streak") or 0),
        "total_guesses": total_guesses,
        "avg_guesses": round(total_guesses / wins, 2) if wins else None,
        "hint_games": int(row.get("hint_games") or 0),
        "hint_wins": int(row.get("hint_wins") or 0),
        "guess_distribution": [int(row.get(f"guess_{index}") or 0) for index in range(1, 7)],
    }


def _achievement_map(conn, user_id: str) -> dict[str, dict[str, Any]]:
    rows = [_row_to_dict(row) for row in _execute(conn, "SELECT * FROM player_achievements WHERE user_id = ?", (user_id,)).fetchall()]
    return {row["achievement_id"]: row for row in rows if row}


def _achievement_progress(conn, user_id: str) -> list[dict[str, Any]]:
    unlocked = _achievement_map(conn, user_id)
    overall = _decorate_stats(_row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = 'overall'", (user_id,)).fetchone()), "overall")
    by_scope = {scope: _decorate_stats(_row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = ?", (user_id, scope)).fetchone()), scope) for scope in SCOPES}
    party_games = _row_to_dict(_execute(conn, "SELECT COUNT(DISTINCT session_id) AS count FROM game_results WHERE user_id = ? AND scope = 'overall' AND mode = 'party'", (user_id,)).fetchone()) or {}
    team_wins = _row_to_dict(_execute(conn, "SELECT COUNT(DISTINCT session_id) AS count FROM game_results WHERE user_id = ? AND scope = 'overall' AND mode = 'party' AND shared_board = 1 AND won = ?", (user_id, True)).fetchone()) or {}
    sharp = _row_to_dict(_execute(conn, "SELECT COUNT(*) AS count FROM game_results WHERE user_id = ? AND scope = 'overall' AND won = ? AND guesses <= 3", (user_id, True)).fetchone()) or {}
    no_hint = _row_to_dict(_execute(conn, "SELECT COUNT(*) AS count FROM game_results WHERE user_id = ? AND scope = 'overall' AND won = ? AND hints_used = 0", (user_id, True)).fetchone()) or {}
    current_values = {
        "first_win": overall["wins"],
        "sharp_solver": int(sharp.get("count") or 0),
        "no_hint_victory": int(no_hint.get("count") or 0),
        "streak_3": overall["current_streak"],
        "streak_10": overall["current_streak"],
        "easy_specialist": by_scope["easy"]["wins"],
        "moderate_master": by_scope["moderate"]["wins"],
        "difficult_dominator": by_scope["difficult"]["wins"],
        "prodigy_solver": by_scope["prodigy"]["wins"],
        "party_player": int(party_games.get("count") or 0),
        "team_solver": int(team_wins.get("count") or 0),
        "weekly_top_10": 1 if "weekly_top_10" in unlocked else 0,
        "weekly_champion": 1 if "weekly_champion" in unlocked else 0,
    }
    items = []
    for achievement in ACHIEVEMENTS:
        current = min(int(current_values.get(achievement["id"], 0)), int(achievement["target"]))
        unlocked_row = unlocked.get(achievement["id"])
        items.append({
            **achievement,
            "current": current,
            "unlocked": bool(unlocked_row),
            "unlocked_at": unlocked_row.get("unlocked_at") if unlocked_row else None,
            "period_key": unlocked_row.get("period_key") if unlocked_row else None,
        })
    return items


def _top_achievements(conn, user_id: str, limit: int = 3) -> list[dict[str, Any]]:
    return [item for item in _achievement_progress(conn, user_id) if item["unlocked"]][:limit]


def _finalize_previous_weeks(conn) -> None:
    current_key, _, _ = _week_bounds()
    rows = [_row_to_dict(row) for row in _execute(conn, "SELECT DISTINCT period_key FROM player_period_stats WHERE period_type = 'weekly' AND scope = 'overall' AND period_key <> ?", (current_key,)).fetchall()]
    for row in rows:
        period_key = row.get("period_key") if row else None
        if not period_key:
            continue
        already = _row_to_dict(_execute(conn, "SELECT 1 FROM player_achievements WHERE achievement_id IN ('weekly_top_10', 'weekly_champion') AND period_key = ? LIMIT 1", (period_key,)).fetchone())
        if already:
            continue
        ranked = [_row_to_dict(r) for r in _execute(
            conn,
            """
            SELECT user_id FROM player_period_stats
            WHERE period_type = 'weekly' AND period_key = ? AND scope = 'overall' AND games_played > 0
            ORDER BY score DESC, wins DESC, max_streak DESC, CASE WHEN wins > 0 THEN CAST(total_guesses AS REAL) / wins ELSE 999 END ASC, updated_at DESC
            LIMIT 10
            """,
            (period_key,),
        ).fetchall()]
        stamp = _now_iso()
        for index, ranked_row in enumerate(ranked):
            if ranked_row:
                _unlock(conn, ranked_row["user_id"], "weekly_top_10", stamp, period_key)
                if index == 0:
                    _unlock(conn, ranked_row["user_id"], "weekly_champion", stamp, period_key)


def _rank_for(conn, user_id: str, scope: str, period: str, period_key: str) -> int | None:
    order = "score DESC, wins DESC, max_streak DESC, CASE WHEN wins > 0 THEN CAST(total_guesses AS REAL) / wins ELSE 999 END ASC, updated_at DESC"
    if period == "all_time":
        rows = _execute(conn, f"SELECT user_id FROM player_stats WHERE scope = ? AND games_played > 0 ORDER BY {order}", (scope,)).fetchall()
    else:
        rows = _execute(conn, f"SELECT user_id FROM player_period_stats WHERE scope = ? AND period_type = 'weekly' AND period_key = ? AND games_played > 0 ORDER BY {order}", (scope, period_key)).fetchall()
    for index, row in enumerate(rows):
        row_user_id = row["user_id"] if isinstance(row, dict) else row[0]
        if row_user_id == user_id:
            return index + 1
    return None


def leaderboard(scope: str = "overall", limit: int = 50, user_id: str | None = None, period: str = "weekly", week: str = "current") -> dict[str, Any]:
    scope = scope if scope in SCOPES else "overall"
    period = period if period in PERIOD_TYPES else "weekly"
    limit = min(max(limit, 1), 100)
    period_key, period_start, period_end = _week_bounds_from_key(week)
    if period == "all_time":
        period_key = ALL_TIME_KEY
    order = "s.score DESC, s.wins DESC, s.max_streak DESC, CASE WHEN s.wins > 0 THEN CAST(s.total_guesses AS REAL) / s.wins ELSE 999 END ASC, s.updated_at DESC"
    source = "player_stats" if period == "all_time" else "player_period_stats"
    where = "s.scope = ? AND s.games_played > 0" if period == "all_time" else "s.scope = ? AND s.period_type = 'weekly' AND s.period_key = ? AND s.games_played > 0"
    params = (scope, limit) if period == "all_time" else (scope, period_key, limit)
    all_params = (scope,) if period == "all_time" else (scope, period_key)
    with _conn() as conn:
        _finalize_previous_weeks(conn)
        _repair_leaderboard_stats(conn)
        rows = [_row_to_dict(row) for row in _execute(
            conn,
            f"""
            SELECT p.user_id, p.username, p.emoji, s.scope, s.score, s.games_played, s.wins, s.losses,
                   s.current_streak, s.max_streak, s.total_guesses, s.hint_games, s.hint_wins,
                   s.guess_1, s.guess_2, s.guess_3, s.guess_4, s.guess_5, s.guess_6, s.updated_at
            FROM {source} s
            JOIN players p ON p.user_id = s.user_id
            WHERE {where}
            ORDER BY {order}
            LIMIT ?
            """,
            params,
        ).fetchall()]
        all_rows = [_row_to_dict(row) for row in _execute(
            conn,
            f"""
            SELECT p.user_id, p.username, p.emoji, s.scope, s.score, s.games_played, s.wins, s.losses,
                   s.current_streak, s.max_streak, s.total_guesses, s.hint_games, s.hint_wins,
                   s.guess_1, s.guess_2, s.guess_3, s.guess_4, s.guess_5, s.guess_6, s.updated_at
            FROM {source} s
            JOIN players p ON p.user_id = s.user_id
            WHERE {where}
            ORDER BY {order}
            """,
            all_params,
        ).fetchall()]

        def decorate(row: dict[str, Any], rank: int) -> dict[str, Any]:
            stats = _decorate_stats(row, scope)
            return {
                "rank": rank,
                "user_id": row["user_id"],
                "username": row["username"],
                "emoji": row.get("emoji") or "ðŸ™‚",
                **{key: value for key, value in stats.items() if key != "scope"},
                "badges": _top_achievements(conn, row["user_id"]),
            }

        decorated = [decorate(row, index + 1) for index, row in enumerate(rows)]
        current_user = None
        if user_id:
            for index, row in enumerate(all_rows):
                if row["user_id"] == user_id:
                    current_user = decorate(row, index + 1)
                    break
    return {
        "scope": scope,
        "period": period,
        "period_key": period_key,
        "period_start": period_start.isoformat() if period == "weekly" else None,
        "period_end": period_end.isoformat() if period == "weekly" else None,
        "resets_at": period_end.isoformat() if period == "weekly" else None,
        "entries": decorated,
        "current_user": current_user,
    }


def public_profile(user_id: str) -> dict[str, Any] | None:
    week_key, week_start, week_end = _week_bounds()
    with _conn() as conn:
        _finalize_previous_weeks(conn)
        _repair_leaderboard_stats(conn)
        player = _row_to_dict(_execute(conn, "SELECT user_id, username, emoji, created_at FROM players WHERE user_id = ?", (user_id,)).fetchone())
        if not player:
            return None
        all_time = {scope: _decorate_stats(_row_to_dict(_execute(conn, "SELECT * FROM player_stats WHERE user_id = ? AND scope = ?", (user_id, scope)).fetchone()), scope) for scope in SCOPES}
        weekly = {scope: _decorate_stats(_row_to_dict(_execute(conn, "SELECT * FROM player_period_stats WHERE user_id = ? AND scope = ? AND period_type = 'weekly' AND period_key = ?", (user_id, scope, week_key)).fetchone()), scope) for scope in SCOPES}
        achievements = _achievement_progress(conn, user_id)
        ranks = {
            "weekly": _rank_for(conn, user_id, "overall", "weekly", week_key),
            "all_time": _rank_for(conn, user_id, "overall", "all_time", ALL_TIME_KEY),
        }
    return {
        "player": player,
        "period": {
            "period_key": week_key,
            "period_start": week_start.isoformat(),
            "period_end": week_end.isoformat(),
            "resets_at": week_end.isoformat(),
        },
        "ranks": ranks,
        "all_time": all_time,
        "weekly": weekly,
        "achievements": achievements,
    }
