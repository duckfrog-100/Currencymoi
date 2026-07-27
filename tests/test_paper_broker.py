from datetime import datetime, timezone
from decimal import Decimal

import pytest

from currencymoi.models import Side
from currencymoi.paper_broker import PaperBroker


NOW = datetime(2026, 7, 27, tzinfo=timezone.utc)


def test_buy_fill_applies_fee_and_adverse_slippage():
    broker = PaperBroker(fee_rate=Decimal("0.0005"), slippage_rate=Decimal("0.0002"))

    fill = broker.buy(
        budget=Decimal("40000"),
        best_ask=Decimal("100000000"),
        timestamp=NOW,
        reason="골든크로스",
        candle_start=NOW,
    )

    assert fill.side is Side.BUY
    assert fill.execution_price == Decimal("100020000.00000000")
    assert fill.gross_amount == Decimal("40000.00000000")
    assert fill.fee == Decimal("20.00000000")
    assert fill.net_amount == Decimal("39980.00000000")
    assert fill.quantity == Decimal("0.0003997200559888")


def test_sell_fill_applies_fee_and_adverse_slippage():
    broker = PaperBroker(fee_rate=Decimal("0.0005"), slippage_rate=Decimal("0.0002"))

    fill = broker.sell(
        quantity=Decimal("0.0004"),
        best_bid=Decimal("101000000"),
        timestamp=NOW,
        reason="데드크로스",
        candle_start=NOW,
    )

    assert fill.side is Side.SELL
    assert fill.execution_price == Decimal("100979800.00000000")
    assert fill.gross_amount == Decimal("40391.92000000")
    assert fill.fee == Decimal("20.19596000")
    assert fill.net_amount == Decimal("40371.72404000")


@pytest.mark.parametrize("method,value", [("buy", Decimal("0")), ("sell", Decimal("0"))])
def test_broker_rejects_non_positive_orders(method: str, value: Decimal):
    broker = PaperBroker(fee_rate=Decimal("0.0005"), slippage_rate=Decimal("0.0002"))
    kwargs = {
        "timestamp": NOW,
        "reason": "test",
        "candle_start": NOW,
    }
    if method == "buy":
        kwargs.update(budget=value, best_ask=Decimal("100"))
    else:
        kwargs.update(quantity=value, best_bid=Decimal("100"))

    with pytest.raises(ValueError):
        getattr(broker, method)(**kwargs)
