from datetime import datetime, timedelta, timezone
from decimal import Decimal

from currencymoi.config import TradingMode
from currencymoi.models import Candle, Decision, Signal
from currencymoi.paper_broker import PaperBroker
from currencymoi.portfolio import Portfolio
from currencymoi.repository import SQLiteRepository


NOW = datetime(2026, 7, 27, tzinfo=timezone.utc)


def test_repository_restores_saved_portfolio_state(tmp_path):
    path = tmp_path / "paper.db"
    repository = SQLiteRepository(path)
    repository.initialize()
    portfolio = Portfolio(Decimal("50000"), Decimal("10000"))
    fill = PaperBroker(Decimal("0.0005"), Decimal("0.0002")).buy(
        Decimal("40000"), Decimal("100000000"), NOW, "buy", NOW
    )
    portfolio.apply_fill(fill)

    repository.save_trade_and_state(
        fill=fill,
        portfolio=portfolio,
        mark_price=Decimal("100000000"),
        running=True,
        mode=TradingMode.NORMAL,
        last_processed_candle=NOW,
    )

    restored = SQLiteRepository(path)
    restored.initialize()
    state = restored.load_state()

    assert state is not None
    assert state.cash == Decimal("10000.00000000")
    assert state.btc_quantity == fill.quantity
    assert state.average_entry_price == portfolio.average_entry_price
    assert state.last_processed_candle == NOW
    assert state.running is True
    assert len(restored.list_trades()) == 1


def test_repository_round_trips_candles_and_decisions(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    repository.initialize()
    candle = Candle(NOW, 60, Decimal("100"), Decimal("110"), Decimal("90"), Decimal("105"), Decimal("3"))
    decision = Decision(
        timestamp=NOW + timedelta(minutes=1),
        candle_start=NOW,
        signal=Signal.HOLD,
        reason="no cross",
        fast_sma=Decimal("102"),
        slow_sma=Decimal("101"),
    )

    repository.save_candle(candle)
    repository.save_decision(decision)

    assert repository.list_candles(60) == [candle]
    assert repository.list_decisions()[0] == decision


def test_repository_reset_restores_exact_starting_balance(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    repository.initialize()
    candle = Candle(NOW, 5, Decimal("100"), Decimal("100"), Decimal("100"), Decimal("100"), Decimal("1"))
    repository.save_candle(candle)
    repository.save_decision(Decision(NOW, NOW, Signal.HOLD, "warmup"))
    portfolio = Portfolio(Decimal("50000"), Decimal("10000"))
    fill = PaperBroker(Decimal("0.0005"), Decimal("0.0002")).buy(
        Decimal("40000"), Decimal("100000000"), NOW, "buy", NOW
    )
    portfolio.apply_fill(fill)
    repository.save_trade_and_state(
        fill, portfolio, Decimal("100000000"), True, TradingMode.DEMO, NOW
    )

    repository.reset(Decimal("50000"), TradingMode.NORMAL)
    state = repository.load_state()

    assert state is not None
    assert state.cash == Decimal("50000.00000000")
    assert state.btc_quantity == Decimal("0")
    assert state.running is False
    assert repository.list_candles(5) == []
    assert repository.list_decisions() == []
    assert repository.list_trades() == []


def test_duplicate_trade_for_same_candle_is_rejected(tmp_path):
    repository = SQLiteRepository(tmp_path / "paper.db")
    repository.initialize()
    portfolio = Portfolio(Decimal("50000"), Decimal("10000"))
    fill = PaperBroker(Decimal("0.0005"), Decimal("0.0002")).buy(
        Decimal("40000"), Decimal("100000000"), NOW, "buy", NOW
    )
    portfolio.apply_fill(fill)
    repository.save_trade_and_state(fill, portfolio, Decimal("100000000"), True, TradingMode.NORMAL, NOW)

    import sqlite3
    import pytest

    with pytest.raises(sqlite3.IntegrityError):
        repository.save_trade_and_state(fill, portfolio, Decimal("100000000"), True, TradingMode.NORMAL, NOW)
