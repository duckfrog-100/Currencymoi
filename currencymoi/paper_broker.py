from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from .models import Fill, Side

QUOTE_QUANTUM = Decimal("0.00000001")
BTC_QUANTUM = Decimal("0.0000000000000001")


def quote(value: Decimal, *, rounding: str = ROUND_HALF_UP) -> Decimal:
    return value.quantize(QUOTE_QUANTUM, rounding=rounding)


def btc(value: Decimal) -> Decimal:
    return value.quantize(BTC_QUANTUM, rounding=ROUND_DOWN)


class PaperBroker:
    def __init__(self, fee_rate: Decimal, slippage_rate: Decimal) -> None:
        if fee_rate < 0 or fee_rate >= 1:
            raise ValueError("fee_rate must be between 0 and 1")
        if slippage_rate < 0 or slippage_rate >= 1:
            raise ValueError("slippage_rate must be between 0 and 1")
        self.fee_rate = fee_rate
        self.slippage_rate = slippage_rate

    def buy(
        self,
        budget: Decimal,
        best_ask: Decimal,
        timestamp: datetime,
        reason: str,
        candle_start: datetime,
    ) -> Fill:
        if budget <= 0:
            raise ValueError("budget must be positive")
        if best_ask <= 0:
            raise ValueError("best_ask must be positive")

        execution_price = quote(best_ask * (Decimal("1") + self.slippage_rate))
        gross_amount = quote(budget)
        fee = quote(gross_amount * self.fee_rate)
        net_amount = quote(gross_amount - fee)
        quantity = btc(net_amount / execution_price)
        if quantity <= 0:
            raise ValueError("calculated quantity must be positive")

        return Fill(
            timestamp=timestamp,
            candle_start=candle_start,
            side=Side.BUY,
            quantity=quantity,
            execution_price=execution_price,
            gross_amount=gross_amount,
            fee=fee,
            net_amount=net_amount,
            reason=reason,
        )

    def sell(
        self,
        quantity: Decimal,
        best_bid: Decimal,
        timestamp: datetime,
        reason: str,
        candle_start: datetime,
    ) -> Fill:
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if best_bid <= 0:
            raise ValueError("best_bid must be positive")

        execution_price = quote(best_bid * (Decimal("1") - self.slippage_rate))
        normalized_quantity = btc(quantity)
        gross_amount = quote(normalized_quantity * execution_price, rounding=ROUND_DOWN)
        fee = quote(gross_amount * self.fee_rate)
        net_amount = quote(gross_amount - fee)

        return Fill(
            timestamp=timestamp,
            candle_start=candle_start,
            side=Side.SELL,
            quantity=normalized_quantity,
            execution_price=execution_price,
            gross_amount=gross_amount,
            fee=fee,
            net_amount=net_amount,
            reason=reason,
        )
