from __future__ import annotations

import sqlite3
import threading
from collections import deque
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

from .candle_builder import CandleBuilder
from .config import BotConfig, TradingMode
from .market_data import UpbitPublicWebSocket
from .models import Candle, Decision, Fill, MarketSnapshot, RuntimeSnapshot, Side, Signal
from .paper_broker import PaperBroker
from .portfolio import Portfolio
from .repository import SQLiteRepository
from .strategy import MovingAverageCrossover


class TradingEngine:
    def __init__(self, config: BotConfig, repository: SQLiteRepository) -> None:
        self._lock = threading.RLock()
        self.config = config
        self.repository = repository
        self.repository.initialize()
        self._events: deque[str] = deque(maxlen=100)
        self._market: MarketSnapshot | None = None
        self._last_decision: Decision | None = None
        self._last_fill: Fill | None = None
        self._connection_status = "연결 대기"
        self._market_client: UpbitPublicWebSocket | None = None

        state = self.repository.load_state()
        if state is not None and state.mode is not config.mode:
            self.config = BotConfig.for_mode(state.mode).with_overrides(
                buy_budget=config.buy_budget,
                minimum_cash=config.minimum_cash,
                fee_rate=config.fee_rate,
                slippage_rate=config.slippage_rate,
            )
            config = self.config
        if state is None:
            self.portfolio = Portfolio(config.starting_cash, config.minimum_cash)
            self.running = False
            self._last_processed_candle: datetime | None = None
            self.repository.save_state(
                self.portfolio, self.running, config.mode, self._last_processed_candle
            )
        else:
            self.portfolio = Portfolio(
                starting_cash=state.starting_cash,
                minimum_cash=config.minimum_cash,
                cash=state.cash,
                btc_quantity=state.btc_quantity,
                average_entry_price=state.average_entry_price,
                realized_pnl=state.realized_pnl,
            )
            self.running = False
            self._last_processed_candle = state.last_processed_candle
            if state.running:
                self._append_event("재시작 안전을 위해 자동매매를 일시정지했습니다.")
            self.repository.save_state(
                self.portfolio, False, config.mode, self._last_processed_candle
            )

        self._rebuild_components()
        self._candles = self.repository.list_candles(self.config.candle_seconds, limit=500)
        trades = self.repository.list_trades(limit=1)
        decisions = self.repository.list_decisions(limit=1)
        self._last_fill = trades[0] if trades else None
        self._last_decision = decisions[0] if decisions else None

    def _rebuild_components(self) -> None:
        self._builder = CandleBuilder(self.config.candle_seconds)
        self._strategy = MovingAverageCrossover(
            self.config.fast_period, self.config.slow_period
        )
        self._broker = PaperBroker(self.config.fee_rate, self.config.slippage_rate)

    def _append_event(self, message: str) -> None:
        timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self._events.appendleft(f"[{timestamp}] {message}")

    def on_market_event(self, message: str) -> None:
        with self._lock:
            if "연결되었습니다" in message:
                self._connection_status = "연결됨"
            elif "종료" in message or "오류" in message or "끊어" in message:
                self._connection_status = "연결 끊김"
            self._append_event(message)

    def connect_market(self) -> None:
        with self._lock:
            if self._market_client is None:
                self._market_client = UpbitPublicWebSocket(
                    self.config.market,
                    self.process_market_snapshot,
                    self.process_trade_tick,
                    self.on_market_event,
                )
            self._market_client.start()
            self._connection_status = "연결 중"

    def shutdown(self) -> None:
        with self._lock:
            if self._market_client is not None:
                self._market_client.stop()

    def start(self) -> None:
        with self._lock:
            if self.running:
                return
            self.running = True
            self.repository.save_state(
                self.portfolio, True, self.config.mode, self._last_processed_candle
            )
            self._append_event("모의 자동매매를 시작했습니다.")

    def pause(self) -> None:
        with self._lock:
            if not self.running:
                return
            self.running = False
            self.repository.save_state(
                self.portfolio, False, self.config.mode, self._last_processed_candle
            )
            self._append_event("모의 자동매매를 일시정지했습니다.")

    def reset(self) -> None:
        with self._lock:
            if self.running:
                raise RuntimeError("reset requires the bot to be paused")
            self.repository.reset(self.config.starting_cash, self.config.mode)
            self.portfolio = Portfolio(self.config.starting_cash, self.config.minimum_cash)
            self._last_processed_candle = None
            self._last_decision = None
            self._last_fill = None
            self._candles = []
            self._rebuild_components()
            self._append_event("거래 기록을 지우고 가상 자금 50,000원으로 초기화했습니다.")

    def change_mode(self, mode: TradingMode) -> None:
        with self._lock:
            if self.running:
                raise RuntimeError("pause the bot before changing mode")
            next_config = BotConfig.for_mode(mode).with_overrides(
                buy_budget=self.config.buy_budget,
                minimum_cash=self.config.minimum_cash,
                fee_rate=self.config.fee_rate,
                slippage_rate=self.config.slippage_rate,
            )
            self.config = next_config
            self._rebuild_components()
            self._candles = self.repository.list_candles(self.config.candle_seconds, limit=500)
            self.repository.save_state(
                self.portfolio, False, self.config.mode, self._last_processed_candle
            )
            self._append_event(f"전략 모드를 {mode.value}로 변경했습니다.")

    def update_execution_settings(
        self,
        *,
        buy_budget: Decimal,
        fee_rate: Decimal,
        slippage_rate: Decimal,
    ) -> None:
        with self._lock:
            if self.running:
                raise RuntimeError("pause the bot before changing settings")
            self.config = self.config.with_overrides(
                buy_budget=buy_budget,
                fee_rate=fee_rate,
                slippage_rate=slippage_rate,
            )
            self._rebuild_components()
            self._append_event("가상 체결 설정을 변경했습니다.")

    def process_market_snapshot(self, snapshot: MarketSnapshot) -> None:
        with self._lock:
            self._market = snapshot
            self._connection_status = "연결됨" if snapshot.connected else "연결 끊김"

    def process_trade_tick(
        self, timestamp: datetime, price: Decimal, volume: Decimal
    ) -> Fill | None:
        with self._lock:
            try:
                completed = self._builder.add_trade(timestamp, price, volume)
            except ValueError as exc:
                self._append_event(f"체결 데이터를 무시했습니다: {exc}")
                return None
            if completed is None:
                return None
            return self.process_completed_candle(completed, now=timestamp)

    def _store_candle_in_memory(self, candle: Candle) -> None:
        for index, existing in enumerate(self._candles):
            if existing.start_time == candle.start_time:
                self._candles[index] = candle
                return
        self._candles.append(candle)
        self._candles.sort(key=lambda item: item.start_time)
        self._candles = self._candles[-500:]

    def _market_is_tradeable(self, now: datetime) -> tuple[bool, str]:
        if self._market is None:
            return False, "실시간 호가가 없어 주문을 생성하지 않았습니다."
        if not self._market.connected:
            return False, "시세 연결이 끊겨 주문을 생성하지 않았습니다."
        if self._market.best_bid <= 0 or self._market.best_ask <= 0:
            return False, "유효한 최우선 호가가 없어 주문을 생성하지 않았습니다."
        age = (now - self._market.timestamp).total_seconds()
        if age > self.config.stale_after_seconds:
            return False, "시세 데이터가 너무 오래되어 주문을 생성하지 않았습니다."
        return True, ""

    def _portfolio_copy(self) -> Portfolio:
        return Portfolio(
            starting_cash=self.portfolio.starting_cash,
            minimum_cash=self.portfolio.minimum_cash,
            cash=self.portfolio.cash,
            btc_quantity=self.portfolio.btc_quantity,
            average_entry_price=self.portfolio.average_entry_price,
            realized_pnl=self.portfolio.realized_pnl,
        )

    def process_completed_candle(
        self, candle: Candle, *, now: datetime | None = None
    ) -> Fill | None:
        now = now or datetime.now(timezone.utc)
        with self._lock:
            self.repository.save_candle(candle)
            self._store_candle_in_memory(candle)
            decision = self._strategy.evaluate(self._candles, self.portfolio.has_position)
            self.repository.save_decision(decision)
            self._last_decision = decision

            if self._last_processed_candle == candle.start_time:
                self._append_event("이미 처리한 봉의 중복 주문을 차단했습니다.")
                return None

            self._last_processed_candle = candle.start_time
            if decision.signal is Signal.HOLD or not self.running:
                self.repository.save_state(
                    self.portfolio, self.running, self.config.mode, self._last_processed_candle
                )
                return None

            tradeable, reason = self._market_is_tradeable(now)
            if not tradeable:
                self._append_event(reason)
                self.repository.save_state(
                    self.portfolio, self.running, self.config.mode, self._last_processed_candle
                )
                return None

            candidate = self._portfolio_copy()
            if decision.signal is Signal.BUY:
                fill = self._broker.buy(
                    budget=self.config.buy_budget,
                    best_ask=self._market.best_ask,
                    timestamp=now,
                    reason=decision.reason,
                    candle_start=candle.start_time,
                )
                candidate.apply_fill(fill)
            else:
                fill = self._broker.sell(
                    quantity=candidate.btc_quantity,
                    best_bid=self._market.best_bid,
                    timestamp=now,
                    reason=decision.reason,
                    candle_start=candle.start_time,
                )
                realized = candidate.apply_fill(fill)
                fill = replace(fill, realized_pnl=realized)

            try:
                self.repository.save_trade_and_state(
                    fill,
                    candidate,
                    self._market.trade_price,
                    self.running,
                    self.config.mode,
                    self._last_processed_candle,
                )
            except sqlite3.IntegrityError:
                self._append_event("DB 중복 제약으로 동일 봉 주문을 차단했습니다.")
                return None

            self.portfolio = candidate
            self._last_fill = fill
            action = "매수" if fill.side is Side.BUY else "매도"
            self._append_event(
                f"가상 {action} 체결: {fill.gross_amount:,.0f}원, 가격 {fill.execution_price:,.0f}원"
            )
            return fill

    def snapshot(self, *, now: datetime | None = None) -> RuntimeSnapshot:
        now = now or datetime.now(timezone.utc)
        with self._lock:
            mark_price = (
                self._market.trade_price
                if self._market is not None
                else self.portfolio.average_entry_price
                if self.portfolio.has_position
                else Decimal("0")
            )
            return RuntimeSnapshot(
                timestamp=now,
                running=self.running,
                mode=self.config.mode.value,
                connection_status=self._connection_status,
                market=self._market,
                portfolio=self.portfolio.snapshot(mark_price, timestamp=now),
                last_decision=self._last_decision,
                last_fill=self._last_fill,
                event_messages=tuple(self._events),
            )
