from datetime import datetime, timedelta, timezone
from decimal import Decimal

from currencymoi.config import BotConfig, TradingMode
from currencymoi.engine import TradingEngine
from currencymoi.models import Candle, MarketSnapshot, Side
from currencymoi.repository import SQLiteRepository


START = datetime(2026, 7, 27, tzinfo=timezone.utc)


def candle(index: int, close: int) -> Candle:
    price = Decimal(str(close))
    return Candle(
        start_time=START + timedelta(minutes=index),
        interval_seconds=60,
        open=price,
        high=price,
        low=price,
        close=price,
        volume=Decimal("1"),
    )


def config() -> BotConfig:
    return BotConfig(
        candle_seconds=60,
        fast_period=3,
        slow_period=5,
        stale_after_seconds=15,
        mode=TradingMode.NORMAL,
    )


def market(at: datetime, price: str = "100000000") -> MarketSnapshot:
    value = Decimal(price)
    return MarketSnapshot(at, value, value - Decimal("1000"), value + Decimal("1000"), True)


def test_engine_buys_then_sells_once_per_completed_candle(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    engine = TradingEngine(config(), repository)
    engine.start()
    closes = [10, 10, 10, 10, 10, 9, 12]

    for index, close in enumerate(closes):
        completed = candle(index, close)
        now = completed.start_time + timedelta(seconds=60)
        engine.process_market_snapshot(market(now))
        engine.process_completed_candle(completed, now=now)

    after_buy = engine.snapshot(now=START + timedelta(minutes=7))
    assert after_buy.portfolio.has_position is True
    assert after_buy.last_fill is not None
    assert after_buy.last_fill.side is Side.BUY
    assert len(repository.list_trades()) == 1

    last_buy_candle = candle(6, 12)
    engine.process_completed_candle(last_buy_candle, now=START + timedelta(minutes=7))
    assert len(repository.list_trades()) == 1

    sell_candle = candle(7, 8)
    sell_time = sell_candle.start_time + timedelta(seconds=60)
    engine.process_market_snapshot(market(sell_time, "101000000"))
    engine.process_completed_candle(sell_candle, now=sell_time)

    after_sell = engine.snapshot(now=sell_time)
    assert after_sell.portfolio.has_position is False
    assert after_sell.last_fill is not None
    assert after_sell.last_fill.side is Side.SELL
    assert len(repository.list_trades()) == 2


def test_engine_rejects_trade_when_market_data_is_stale(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    engine = TradingEngine(config(), repository)
    engine.start()
    stale_time = START
    engine.process_market_snapshot(market(stale_time))

    closes = [10, 10, 10, 10, 10, 9, 12]
    for index, close in enumerate(closes):
        completed = candle(index, close)
        engine.process_completed_candle(completed, now=START + timedelta(hours=1))

    snapshot = engine.snapshot(now=START + timedelta(hours=1))
    assert snapshot.portfolio.has_position is False
    assert repository.list_trades() == []
    assert any("오래" in message for message in snapshot.event_messages)


def test_paused_engine_records_decisions_but_does_not_trade(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    engine = TradingEngine(config(), repository)
    engine.process_market_snapshot(market(START + timedelta(minutes=7)))

    for index, close in enumerate([10, 10, 10, 10, 10, 9, 12]):
        engine.process_completed_candle(candle(index, close), now=START + timedelta(minutes=7))

    assert repository.list_trades() == []
    assert len(repository.list_decisions()) == 7
    assert engine.snapshot(now=START + timedelta(minutes=7)).portfolio.cash == Decimal("50000.00000000")


def test_reset_restores_balance_and_clears_history(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    engine = TradingEngine(config(), repository)
    engine.start()
    for index, close in enumerate([10, 10, 10, 10, 10, 9, 12]):
        now = START + timedelta(minutes=7)
        engine.process_market_snapshot(market(now))
        engine.process_completed_candle(candle(index, close), now=now)

    engine.pause()
    engine.reset()

    snapshot = engine.snapshot(now=START + timedelta(minutes=8))
    assert snapshot.portfolio.cash == Decimal("50000.00000000")
    assert snapshot.portfolio.has_position is False
    assert repository.list_trades() == []
    assert repository.list_candles(60) == []
