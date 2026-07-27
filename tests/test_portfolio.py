from datetime import datetime, timezone
from decimal import Decimal

import pytest

from currencymoi.models import Fill, Side
from currencymoi.paper_broker import PaperBroker
from currencymoi.portfolio import Portfolio


NOW = datetime(2026, 7, 27, tzinfo=timezone.utc)


def test_buy_and_sell_update_wallet_and_realized_pnl():
    broker = PaperBroker(Decimal("0.0005"), Decimal("0.0002"))
    portfolio = Portfolio(starting_cash=Decimal("50000"), minimum_cash=Decimal("10000"))
    buy = broker.buy(Decimal("40000"), Decimal("100000000"), NOW, "buy", NOW)

    portfolio.apply_fill(buy)
    bought = portfolio.snapshot(Decimal("100000000"), timestamp=NOW)

    assert bought.cash == Decimal("10000.00000000")
    assert bought.btc_quantity == buy.quantity
    assert bought.has_position is True
    assert bought.average_entry_price == Decimal("100070035.01750932")

    sell = broker.sell(buy.quantity, Decimal("101000000"), NOW, "sell", NOW)
    realized = portfolio.apply_fill(sell)
    closed = portfolio.snapshot(Decimal("101000000"), timestamp=NOW)

    assert closed.btc_quantity == Decimal("0")
    assert closed.average_entry_price == Decimal("0")
    assert closed.cash == Decimal("50343.46948408")
    assert realized == Decimal("343.46948408")
    assert closed.realized_pnl == realized
    assert closed.total_pnl == realized


def test_portfolio_rejects_buy_that_breaks_minimum_cash():
    portfolio = Portfolio(starting_cash=Decimal("50000"), minimum_cash=Decimal("10000"))
    fill = Fill(
        timestamp=NOW,
        candle_start=NOW,
        side=Side.BUY,
        quantity=Decimal("1"),
        execution_price=Decimal("41000"),
        gross_amount=Decimal("41000"),
        fee=Decimal("0"),
        net_amount=Decimal("41000"),
        reason="invalid",
    )

    with pytest.raises(ValueError, match="minimum cash"):
        portfolio.apply_fill(fill)


def test_portfolio_rejects_invalid_position_actions():
    portfolio = Portfolio(starting_cash=Decimal("50000"), minimum_cash=Decimal("10000"))
    sell = Fill(
        timestamp=NOW,
        candle_start=NOW,
        side=Side.SELL,
        quantity=Decimal("1"),
        execution_price=Decimal("100"),
        gross_amount=Decimal("100"),
        fee=Decimal("0"),
        net_amount=Decimal("100"),
        reason="invalid",
    )

    with pytest.raises(ValueError, match="insufficient BTC"):
        portfolio.apply_fill(sell)
