from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from enum import Enum


class TradingMode(str, Enum):
    NORMAL = "normal"
    DEMO = "demo"


@dataclass(frozen=True, slots=True)
class BotConfig:
    market: str = "KRW-BTC"
    starting_cash: Decimal = Decimal("50000")
    buy_budget: Decimal = Decimal("40000")
    minimum_cash: Decimal = Decimal("10000")
    fee_rate: Decimal = Decimal("0.0005")
    slippage_rate: Decimal = Decimal("0.0002")
    candle_seconds: int = 60
    fast_period: int = 5
    slow_period: int = 20
    stale_after_seconds: int = 15
    mode: TradingMode = TradingMode.NORMAL

    def __post_init__(self) -> None:
        if not self.market or "-" not in self.market:
            raise ValueError("market must be a non-empty pair code")
        if self.starting_cash <= 0:
            raise ValueError("starting_cash must be positive")
        if self.buy_budget <= 0:
            raise ValueError("buy_budget must be positive")
        if self.minimum_cash < 0:
            raise ValueError("minimum_cash must not be negative")
        if self.buy_budget + self.minimum_cash > self.starting_cash:
            raise ValueError("buy_budget must preserve minimum_cash")
        if self.fee_rate < 0 or self.fee_rate >= 1:
            raise ValueError("fee_rate must be between 0 and 1")
        if self.slippage_rate < 0 or self.slippage_rate >= 1:
            raise ValueError("slippage_rate must be between 0 and 1")
        if self.candle_seconds <= 0:
            raise ValueError("candle_seconds must be positive")
        if self.fast_period <= 0 or self.slow_period <= 0:
            raise ValueError("moving-average periods must be positive")
        if self.fast_period >= self.slow_period:
            raise ValueError("fast_period must be less than slow_period")
        if self.stale_after_seconds <= 0:
            raise ValueError("stale_after_seconds must be positive")

    @classmethod
    def for_mode(cls, mode: TradingMode) -> "BotConfig":
        if mode is TradingMode.DEMO:
            return cls(
                candle_seconds=5,
                fast_period=3,
                slow_period=7,
                stale_after_seconds=10,
                mode=mode,
            )
        return cls(mode=TradingMode.NORMAL)

    def with_overrides(self, **changes: object) -> "BotConfig":
        return replace(self, **changes)
