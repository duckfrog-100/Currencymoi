from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Sequence

from .models import Candle, Decision, Signal


class MovingAverageCrossover:
    def __init__(self, fast_period: int, slow_period: int) -> None:
        if fast_period <= 0 or slow_period <= 0:
            raise ValueError("periods must be positive")
        if fast_period >= slow_period:
            raise ValueError("fast_period must be less than slow_period")
        self.fast_period = fast_period
        self.slow_period = slow_period

    @staticmethod
    def _sma(values: Sequence[Decimal], period: int) -> Decimal:
        window = values[-period:]
        return sum(window, Decimal("0")) / Decimal(period)

    def evaluate(self, candles: Sequence[Candle], has_position: bool) -> Decision:
        required = self.slow_period + 1
        if not candles:
            raise ValueError("at least one candle is required")

        last = candles[-1]
        decision_time = last.start_time + timedelta(seconds=last.interval_seconds)
        if len(candles) < required:
            return Decision(
                timestamp=decision_time,
                candle_start=last.start_time,
                signal=Signal.HOLD,
                reason=f"이동평균 계산에 {required}개 봉이 필요합니다 ({len(candles)}개 보유).",
            )

        closes = [candle.close for candle in candles]
        prior = closes[:-1]
        previous_fast = self._sma(prior, self.fast_period)
        previous_slow = self._sma(prior, self.slow_period)
        current_fast = self._sma(closes, self.fast_period)
        current_slow = self._sma(closes, self.slow_period)

        crossed_up = previous_fast <= previous_slow and current_fast > current_slow
        crossed_down = previous_fast >= previous_slow and current_fast < current_slow

        if crossed_up:
            if has_position:
                signal = Signal.HOLD
                reason = "단기 이동평균이 상향 돌파했지만 이미 BTC를 보유 중입니다."
            else:
                signal = Signal.BUY
                reason = "단기 이동평균이 장기 이동평균을 상향 돌파했습니다."
        elif crossed_down:
            if has_position:
                signal = Signal.SELL
                reason = "단기 이동평균이 장기 이동평균을 하향 돌파했습니다."
            else:
                signal = Signal.HOLD
                reason = "단기 이동평균이 하향 돌파했지만 BTC를 미보유 중입니다."
        else:
            signal = Signal.HOLD
            reason = "새로운 이동평균 교차가 없습니다."

        return Decision(
            timestamp=decision_time,
            candle_start=last.start_time,
            signal=signal,
            reason=(
                f"{reason} 이전 단기/장기={previous_fast}/{previous_slow}, "
                f"현재 단기/장기={current_fast}/{current_slow}."
            ),
            fast_sma=current_fast,
            slow_sma=current_slow,
        )
