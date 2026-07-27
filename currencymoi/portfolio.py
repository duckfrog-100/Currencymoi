from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from .models import Fill, PortfolioSnapshot, Side
from .paper_broker import BTC_QUANTUM, QUOTE_QUANTUM, quote


class Portfolio:
    def __init__(
        self,
        starting_cash: Decimal,
        minimum_cash: Decimal,
        *,
        cash: Decimal | None = None,
        btc_quantity: Decimal = Decimal("0"),
        average_entry_price: Decimal = Decimal("0"),
        realized_pnl: Decimal = Decimal("0"),
    ) -> None:
        if starting_cash <= 0:
            raise ValueError("starting_cash must be positive")
        if minimum_cash < 0:
            raise ValueError("minimum_cash must not be negative")
        self.starting_cash = quote(starting_cash)
        self.minimum_cash = quote(minimum_cash)
        self.cash = quote(starting_cash if cash is None else cash)
        self.btc_quantity = btc_quantity.quantize(BTC_QUANTUM)
        self.average_entry_price = quote(average_entry_price) if btc_quantity > 0 else Decimal("0")
        self.realized_pnl = quote(realized_pnl)
        self.last_fill: Fill | None = None

    @property
    def has_position(self) -> bool:
        return self.btc_quantity > 0

    def apply_fill(self, fill: Fill) -> Decimal:
        if fill.side is Side.BUY:
            return self._apply_buy(fill)
        return self._apply_sell(fill)

    def _apply_buy(self, fill: Fill) -> Decimal:
        if self.has_position:
            raise ValueError("cannot buy while a BTC position is already open")
        remaining_cash = quote(self.cash - fill.gross_amount)
        if remaining_cash < self.minimum_cash:
            raise ValueError("buy would break minimum cash requirement")
        if fill.quantity <= 0:
            raise ValueError("buy quantity must be positive")

        self.cash = remaining_cash
        self.btc_quantity = fill.quantity.quantize(BTC_QUANTUM)
        self.average_entry_price = quote(fill.gross_amount / fill.quantity)
        self.last_fill = fill
        return Decimal("0")

    def _apply_sell(self, fill: Fill) -> Decimal:
        if fill.quantity <= 0 or fill.quantity > self.btc_quantity:
            raise ValueError("insufficient BTC for sell")

        cost_basis = quote(self.average_entry_price * fill.quantity)
        realized = quote(fill.net_amount - cost_basis)
        self.cash = quote(self.cash + fill.net_amount)
        self.btc_quantity = (self.btc_quantity - fill.quantity).quantize(BTC_QUANTUM)
        self.realized_pnl = quote(self.realized_pnl + realized)
        if self.btc_quantity == 0:
            self.average_entry_price = Decimal("0")
        self.last_fill = fill
        return realized

    def snapshot(
        self,
        mark_price: Decimal,
        *,
        timestamp: datetime | None = None,
    ) -> PortfolioSnapshot:
        if mark_price < 0:
            raise ValueError("mark_price must not be negative")
        timestamp = timestamp or datetime.now(timezone.utc)
        btc_value = quote(self.btc_quantity * mark_price)
        total_equity = quote(self.cash + btc_value)
        cost_basis = quote(self.average_entry_price * self.btc_quantity) if self.has_position else Decimal("0")
        unrealized_pnl = quote(btc_value - cost_basis)
        total_pnl = quote(total_equity - self.starting_cash)
        return_rate = (total_pnl / self.starting_cash).quantize(Decimal("0.00000001"))

        return PortfolioSnapshot(
            timestamp=timestamp,
            starting_cash=self.starting_cash,
            cash=self.cash,
            btc_quantity=self.btc_quantity,
            average_entry_price=self.average_entry_price,
            mark_price=quote(mark_price),
            btc_value=btc_value,
            total_equity=total_equity,
            realized_pnl=self.realized_pnl,
            unrealized_pnl=unrealized_pnl,
            total_pnl=total_pnl,
            return_rate=return_rate,
            has_position=self.has_position,
        )
