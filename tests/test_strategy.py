from datetime import datetime, timedelta, timezone
from decimal import Decimal

from currencymoi.models import Candle, Signal
from currencymoi.strategy import MovingAverageCrossover


def candles(closes: list[int]) -> list[Candle]:
    start = datetime(2026, 7, 27, tzinfo=timezone.utc)
    return [
        Candle(
            start_time=start + timedelta(minutes=index),
            interval_seconds=60,
            open=Decimal(str(close)),
            high=Decimal(str(close)),
            low=Decimal(str(close)),
            close=Decimal(str(close)),
            volume=Decimal("1"),
        )
        for index, close in enumerate(closes)
    ]


def test_strategy_holds_until_it_has_prior_and_current_windows():
    strategy = MovingAverageCrossover(fast_period=3, slow_period=5)

    decision = strategy.evaluate(candles([10, 10, 10, 10, 10]), has_position=False)

    assert decision.signal is Signal.HOLD
    assert "6" in decision.reason


def test_strategy_buys_on_upward_cross_only_when_flat():
    strategy = MovingAverageCrossover(fast_period=3, slow_period=5)
    history = candles([10, 10, 10, 10, 10, 9, 12])

    buy = strategy.evaluate(history, has_position=False)
    hold = strategy.evaluate(history, has_position=True)

    assert buy.signal is Signal.BUY
    assert buy.fast_sma > buy.slow_sma
    assert "상향 돌파" in buy.reason
    assert hold.signal is Signal.HOLD
    assert "보유" in hold.reason


def test_strategy_sells_on_downward_cross_only_when_holding():
    strategy = MovingAverageCrossover(fast_period=3, slow_period=5)
    history = candles([10, 10, 10, 10, 10, 11, 8])

    sell = strategy.evaluate(history, has_position=True)
    hold = strategy.evaluate(history, has_position=False)

    assert sell.signal is Signal.SELL
    assert sell.fast_sma < sell.slow_sma
    assert "하향 돌파" in sell.reason
    assert hold.signal is Signal.HOLD
    assert "미보유" in hold.reason
