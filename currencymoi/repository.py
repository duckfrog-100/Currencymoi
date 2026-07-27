from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from .config import TradingMode
from .models import Candle, Decision, Fill, Side, Signal
from .portfolio import Portfolio


@dataclass(frozen=True, slots=True)
class PersistedState:
    running: bool
    mode: TradingMode
    starting_cash: Decimal
    cash: Decimal
    btc_quantity: Decimal
    average_entry_price: Decimal
    realized_pnl: Decimal
    last_processed_candle: datetime | None
    updated_at: datetime


class SQLiteRepository:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @staticmethod
    def _dt(value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must be timezone-aware")
        return value.astimezone(timezone.utc).isoformat()

    @staticmethod
    def _parse_dt(value: str | None) -> datetime | None:
        return datetime.fromisoformat(value) if value else None

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS bot_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    running INTEGER NOT NULL,
                    mode TEXT NOT NULL,
                    starting_cash TEXT NOT NULL,
                    cash TEXT NOT NULL,
                    btc_quantity TEXT NOT NULL,
                    average_entry_price TEXT NOT NULL,
                    realized_pnl TEXT NOT NULL,
                    last_processed_candle TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS candles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    interval_seconds INTEGER NOT NULL,
                    start_time TEXT NOT NULL,
                    open TEXT NOT NULL,
                    high TEXT NOT NULL,
                    low TEXT NOT NULL,
                    close TEXT NOT NULL,
                    volume TEXT NOT NULL,
                    UNIQUE(interval_seconds, start_time)
                );

                CREATE TABLE IF NOT EXISTS decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    candle_start TEXT NOT NULL,
                    signal TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    fast_sma TEXT,
                    slow_sma TEXT,
                    UNIQUE(candle_start)
                );

                CREATE TABLE IF NOT EXISTS trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    candle_start TEXT NOT NULL UNIQUE,
                    side TEXT NOT NULL,
                    quantity TEXT NOT NULL,
                    execution_price TEXT NOT NULL,
                    gross_amount TEXT NOT NULL,
                    fee TEXT NOT NULL,
                    net_amount TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    realized_pnl TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS equity_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    cash TEXT NOT NULL,
                    btc_value TEXT NOT NULL,
                    total_equity TEXT NOT NULL,
                    realized_pnl TEXT NOT NULL,
                    unrealized_pnl TEXT NOT NULL
                );
                """
            )

    def save_candle(self, candle: Candle) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO candles(interval_seconds, start_time, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(interval_seconds, start_time) DO UPDATE SET
                    open=excluded.open,
                    high=excluded.high,
                    low=excluded.low,
                    close=excluded.close,
                    volume=excluded.volume
                """,
                (
                    candle.interval_seconds,
                    self._dt(candle.start_time),
                    str(candle.open),
                    str(candle.high),
                    str(candle.low),
                    str(candle.close),
                    str(candle.volume),
                ),
            )

    def save_decision(self, decision: Decision) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO decisions(timestamp, candle_start, signal, reason, fast_sma, slow_sma)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(candle_start) DO UPDATE SET
                    timestamp=excluded.timestamp,
                    signal=excluded.signal,
                    reason=excluded.reason,
                    fast_sma=excluded.fast_sma,
                    slow_sma=excluded.slow_sma
                """,
                (
                    self._dt(decision.timestamp),
                    self._dt(decision.candle_start),
                    decision.signal.value,
                    decision.reason,
                    None if decision.fast_sma is None else str(decision.fast_sma),
                    None if decision.slow_sma is None else str(decision.slow_sma),
                ),
            )

    def _upsert_state(
        self,
        connection: sqlite3.Connection,
        portfolio: Portfolio,
        running: bool,
        mode: TradingMode,
        last_processed_candle: datetime | None,
        updated_at: datetime,
    ) -> None:
        connection.execute(
            """
            INSERT INTO bot_state(
                id, running, mode, starting_cash, cash, btc_quantity,
                average_entry_price, realized_pnl, last_processed_candle, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                running=excluded.running,
                mode=excluded.mode,
                starting_cash=excluded.starting_cash,
                cash=excluded.cash,
                btc_quantity=excluded.btc_quantity,
                average_entry_price=excluded.average_entry_price,
                realized_pnl=excluded.realized_pnl,
                last_processed_candle=excluded.last_processed_candle,
                updated_at=excluded.updated_at
            """,
            (
                int(running),
                mode.value,
                str(portfolio.starting_cash),
                str(portfolio.cash),
                str(portfolio.btc_quantity),
                str(portfolio.average_entry_price),
                str(portfolio.realized_pnl),
                self._dt(last_processed_candle),
                self._dt(updated_at),
            ),
        )

    def save_state(
        self,
        portfolio: Portfolio,
        running: bool,
        mode: TradingMode,
        last_processed_candle: datetime | None,
    ) -> None:
        with self._connect() as connection:
            self._upsert_state(
                connection,
                portfolio,
                running,
                mode,
                last_processed_candle,
                datetime.now(timezone.utc),
            )

    def save_trade_and_state(
        self,
        fill: Fill,
        portfolio: Portfolio,
        mark_price: Decimal,
        running: bool,
        mode: TradingMode,
        last_processed_candle: datetime | None,
    ) -> None:
        snapshot = portfolio.snapshot(mark_price, timestamp=fill.timestamp)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO trades(
                    timestamp, candle_start, side, quantity, execution_price,
                    gross_amount, fee, net_amount, reason, realized_pnl
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self._dt(fill.timestamp),
                    self._dt(fill.candle_start),
                    fill.side.value,
                    str(fill.quantity),
                    str(fill.execution_price),
                    str(fill.gross_amount),
                    str(fill.fee),
                    str(fill.net_amount),
                    fill.reason,
                    str(fill.realized_pnl),
                ),
            )
            self._upsert_state(
                connection,
                portfolio,
                running,
                mode,
                last_processed_candle,
                fill.timestamp,
            )
            connection.execute(
                """
                INSERT INTO equity_snapshots(
                    timestamp, cash, btc_value, total_equity, realized_pnl, unrealized_pnl
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    self._dt(snapshot.timestamp),
                    str(snapshot.cash),
                    str(snapshot.btc_value),
                    str(snapshot.total_equity),
                    str(snapshot.realized_pnl),
                    str(snapshot.unrealized_pnl),
                ),
            )

    def load_state(self) -> PersistedState | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM bot_state WHERE id = 1").fetchone()
        if row is None:
            return None
        return PersistedState(
            running=bool(row["running"]),
            mode=TradingMode(row["mode"]),
            starting_cash=Decimal(row["starting_cash"]),
            cash=Decimal(row["cash"]),
            btc_quantity=Decimal(row["btc_quantity"]),
            average_entry_price=Decimal(row["average_entry_price"]),
            realized_pnl=Decimal(row["realized_pnl"]),
            last_processed_candle=self._parse_dt(row["last_processed_candle"]),
            updated_at=self._parse_dt(row["updated_at"]),
        )

    def list_candles(self, interval_seconds: int, limit: int = 500) -> list[Candle]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM (
                    SELECT * FROM candles WHERE interval_seconds = ?
                    ORDER BY start_time DESC LIMIT ?
                ) ORDER BY start_time ASC
                """,
                (interval_seconds, limit),
            ).fetchall()
        return [
            Candle(
                start_time=self._parse_dt(row["start_time"]),
                interval_seconds=row["interval_seconds"],
                open=Decimal(row["open"]),
                high=Decimal(row["high"]),
                low=Decimal(row["low"]),
                close=Decimal(row["close"]),
                volume=Decimal(row["volume"]),
            )
            for row in rows
        ]

    def list_decisions(self, limit: int = 100) -> list[Decision]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
        return [
            Decision(
                timestamp=self._parse_dt(row["timestamp"]),
                candle_start=self._parse_dt(row["candle_start"]),
                signal=Signal(row["signal"]),
                reason=row["reason"],
                fast_sma=None if row["fast_sma"] is None else Decimal(row["fast_sma"]),
                slow_sma=None if row["slow_sma"] is None else Decimal(row["slow_sma"]),
            )
            for row in rows
        ]

    def list_trades(self, limit: int = 100) -> list[Fill]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
        return [
            Fill(
                timestamp=self._parse_dt(row["timestamp"]),
                candle_start=self._parse_dt(row["candle_start"]),
                side=Side(row["side"]),
                quantity=Decimal(row["quantity"]),
                execution_price=Decimal(row["execution_price"]),
                gross_amount=Decimal(row["gross_amount"]),
                fee=Decimal(row["fee"]),
                net_amount=Decimal(row["net_amount"]),
                reason=row["reason"],
                realized_pnl=Decimal(row["realized_pnl"]),
            )
            for row in rows
        ]

    def reset(self, starting_cash: Decimal, mode: TradingMode) -> None:
        now = datetime.now(timezone.utc)
        with self._connect() as connection:
            connection.execute("DELETE FROM equity_snapshots")
            connection.execute("DELETE FROM trades")
            connection.execute("DELETE FROM decisions")
            connection.execute("DELETE FROM candles")
            connection.execute("DELETE FROM bot_state")
            portfolio = Portfolio(starting_cash=starting_cash, minimum_cash=Decimal("10000"))
            self._upsert_state(connection, portfolio, False, mode, None, now)
