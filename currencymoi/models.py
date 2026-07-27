from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass(frozen=True, slots=True)
class MarketSnapshot:
    timestamp: datetime
    trade_price: Decimal
    best_bid: Decimal
    best_ask: Decimal
    connected: bool = True


@dataclass(frozen=True, slots=True)
class Candle:
    start_time: datetime
    interval_seconds: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


@dataclass(frozen=True, slots=True)
class Decision:
    timestamp: datetime
    candle_start: datetime
    signal: Signal
    reason: str
    fast_sma: Decimal | None = None
    slow_sma: Decimal | None = None


@dataclass(frozen=True, slots=True)
class Fill:
    timestamp: datetime
    candle_start: datetime
    side: Side
    quantity: Decimal
    execution_price: Decimal
    gross_amount: Decimal
    fee: Decimal
    net_amount: Decimal
    reason: str
    realized_pnl: Decimal = Decimal("0")


@dataclass(frozen=True, slots=True)
class PortfolioSnapshot:
    timestamp: datetime
    starting_cash: Decimal
    cash: Decimal
    btc_quantity: Decimal
    average_entry_price: Decimal
    mark_price: Decimal
    btc_value: Decimal
    total_equity: Decimal
    realized_pnl: Decimal
    unrealized_pnl: Decimal
    total_pnl: Decimal
    return_rate: Decimal
    has_position: bool


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    timestamp: datetime
    running: bool
    mode: str
    connection_status: str
    market: MarketSnapshot | None
    portfolio: PortfolioSnapshot
    last_decision: Decision | None
    last_fill: Fill | None
    event_messages: tuple[str, ...]
