from datetime import datetime, timezone
from decimal import Decimal

import pytest

from currencymoi.candle_builder import CandleBuilder


def utc(hour: int, minute: int, second: int) -> datetime:
    return datetime(2026, 7, 27, hour, minute, second, tzinfo=timezone.utc)


def test_builder_returns_completed_candle_on_interval_rollover():
    builder = CandleBuilder(interval_seconds=60)

    assert builder.add_trade(utc(0, 0, 1), Decimal("100"), Decimal("1")) is None
    assert builder.add_trade(utc(0, 0, 30), Decimal("110"), Decimal("2")) is None
    candle = builder.add_trade(utc(0, 1, 0), Decimal("105"), Decimal("1"))

    assert candle is not None
    assert candle.start_time == utc(0, 0, 0)
    assert (candle.open, candle.high, candle.low, candle.close, candle.volume) == (
        Decimal("100"),
        Decimal("110"),
        Decimal("100"),
        Decimal("110"),
        Decimal("3"),
    )


def test_builder_rejects_naive_timestamps_and_non_positive_values():
    builder = CandleBuilder(interval_seconds=60)

    with pytest.raises(ValueError, match="timezone-aware"):
        builder.add_trade(datetime(2026, 7, 27, 0, 0, 1), Decimal("100"), Decimal("1"))
    with pytest.raises(ValueError, match="price"):
        builder.add_trade(utc(0, 0, 1), Decimal("0"), Decimal("1"))
    with pytest.raises(ValueError, match="volume"):
        builder.add_trade(utc(0, 0, 1), Decimal("100"), Decimal("-1"))


def test_builder_ignores_out_of_order_trade_for_previous_bucket():
    builder = CandleBuilder(interval_seconds=60)
    builder.add_trade(utc(0, 1, 1), Decimal("100"), Decimal("1"))

    with pytest.raises(ValueError, match="out of order"):
        builder.add_trade(utc(0, 0, 59), Decimal("99"), Decimal("1"))
