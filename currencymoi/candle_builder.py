from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from .models import Candle


@dataclass(slots=True)
class _OpenCandle:
    start_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


class CandleBuilder:
    def __init__(self, interval_seconds: int) -> None:
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        self.interval_seconds = interval_seconds
        self._current: _OpenCandle | None = None

    def _bucket_start(self, timestamp: datetime) -> datetime:
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("timestamp must be timezone-aware")
        epoch_seconds = int(timestamp.timestamp())
        bucket = epoch_seconds - (epoch_seconds % self.interval_seconds)
        return datetime.fromtimestamp(bucket, tz=timezone.utc)

    def add_trade(self, timestamp: datetime, price: Decimal, volume: Decimal) -> Candle | None:
        if price <= 0:
            raise ValueError("price must be positive")
        if volume < 0:
            raise ValueError("volume must not be negative")

        start = self._bucket_start(timestamp)
        if self._current is None:
            self._current = _OpenCandle(start, price, price, price, price, volume)
            return None

        if start < self._current.start_time:
            raise ValueError("trade timestamp is out of order")

        if start == self._current.start_time:
            self._current.high = max(self._current.high, price)
            self._current.low = min(self._current.low, price)
            self._current.close = price
            self._current.volume += volume
            return None

        completed = Candle(
            start_time=self._current.start_time,
            interval_seconds=self.interval_seconds,
            open=self._current.open,
            high=self._current.high,
            low=self._current.low,
            close=self._current.close,
            volume=self._current.volume,
        )
        self._current = _OpenCandle(start, price, price, price, price, volume)
        return completed

    def current_candle(self) -> Candle | None:
        if self._current is None:
            return None
        return Candle(
            start_time=self._current.start_time,
            interval_seconds=self.interval_seconds,
            open=self._current.open,
            high=self._current.high,
            low=self._current.low,
            close=self._current.close,
            volume=self._current.volume,
        )
