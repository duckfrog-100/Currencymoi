#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"]
UNITS_PER_COIN = {
    "KRW-BTC": 100_000_000,
    "KRW-ETH": 100_000_000,
    "KRW-XRP": 1_000_000,
    "KRW-SOL": 1_000_000,
    "KRW-DOGE": 1_000_000,
}
TIE_BREAK = {market: index for index, market in enumerate(MARKETS)}

START = datetime(2026, 6, 27, 7, 0, 0, tzinfo=timezone.utc)
END = datetime(2026, 7, 27, 7, 0, 0, tzinfo=timezone.utc)
FETCH_START = START - timedelta(minutes=25)

STARTING_CASH = 50_000
MINIMUM_CASH = 10_000
MAX_POSITIONS = 2
MAX_OUTFLOW = 20_000
FEE_RATE = 0.0005
SLIPPAGE_RATE = 0.0002
FAST = 5
SLOW = 20

API = "https://api.upbit.com/v1/candles/minutes/1"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Currencymoi-backtest/1.0"})


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def fetch_market(market: str) -> list[dict[str, Any]]:
    to = END
    rows: dict[datetime, dict[str, Any]] = {}
    request_count = 0
    while True:
        params = {
            "market": market,
            "to": to.isoformat().replace("+00:00", "Z"),
            "count": 200,
        }
        for attempt in range(8):
            response = SESSION.get(API, params=params, timeout=30)
            if response.status_code == 429:
                time.sleep(min(2 ** attempt, 15))
                continue
            response.raise_for_status()
            break
        else:
            raise RuntimeError(f"{market}: repeated rate-limit failure")

        payload = response.json()
        request_count += 1
        if not payload:
            break

        oldest: datetime | None = None
        for item in payload:
            timestamp = parse_utc(item["candle_date_time_utc"])
            oldest = timestamp if oldest is None or timestamp < oldest else oldest
            if FETCH_START <= timestamp < END:
                rows[timestamp] = {
                    "time": timestamp,
                    "open": float(item["opening_price"]),
                    "high": float(item["high_price"]),
                    "low": float(item["low_price"]),
                    "close": float(item["trade_price"]),
                    "volume": float(item["candle_acc_trade_volume"]),
                }

        if oldest is None or oldest <= FETCH_START:
            break
        to = oldest
        if request_count % 30 == 0:
            print(f"FETCH {market} requests={request_count} oldest={oldest.isoformat()}", flush=True)
        time.sleep(0.12)

    candles = [rows[key] for key in sorted(rows)]
    print(f"FETCH_DONE {market} candles={len(candles)} requests={request_count}", flush=True)
    return candles


def sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def score_candidate(candles: list[dict[str, Any]], fast_sma: float, slow_sma: float) -> dict[str, float]:
    latest = candles[-1]
    moving_raw = (fast_sma - slow_sma) / slow_sma if slow_sma > 0 else 0.0
    moving = clamp(moving_raw / 0.01, 0.0, 1.0) * 50.0

    momentum_base = candles[-4]["close"] if len(candles) >= 4 else None
    momentum_raw = ((latest["close"] - momentum_base) / momentum_base) if momentum_base else 0.0
    momentum = clamp(momentum_raw / 0.03, 0.0, 1.0) * 30.0

    previous_five = candles[-6:-1] if len(candles) >= 6 else []
    average_volume = sum(max(0.0, item["volume"]) for item in previous_five) / 5 if len(previous_five) == 5 else 0.0
    ratio = max(0.0, latest["volume"]) / average_volume if average_volume > 0 else 0.0
    volume = clamp((ratio - 1.0) / 2.0, 0.0, 1.0) * 20.0
    ranking = moving + momentum + volume
    return {
        "total": round(ranking + 1e-12, 2),
        "rankingValue": ranking,
        "movingAverage": round(moving + 1e-12, 2),
        "momentum": round(momentum + 1e-12, 2),
        "volume": round(volume + 1e-12, 2),
    }


def evaluate(candles: list[dict[str, Any]], has_position: bool) -> dict[str, Any]:
    if len(candles) < SLOW + 1:
        return {"signal": "HOLD", "score": {"total": 0.0, "rankingValue": 0.0}}
    closes = [item["close"] for item in candles]
    previous = closes[:-1]
    previous_fast = sma(previous, FAST)
    previous_slow = sma(previous, SLOW)
    current_fast = sma(closes, FAST)
    current_slow = sma(closes, SLOW)
    assert previous_fast is not None and previous_slow is not None
    assert current_fast is not None and current_slow is not None
    crossed_up = previous_fast <= previous_slow and current_fast > current_slow
    crossed_down = previous_fast >= previous_slow and current_fast < current_slow
    signal = "HOLD"
    if crossed_up and not has_position:
        signal = "BUY"
    elif crossed_down and has_position:
        signal = "SELL"
    return {"signal": signal, "score": score_candidate(candles, current_fast, current_slow)}


@dataclass
class Position:
    units: int
    cost_basis: int
    entry_price: float
    buy_fee: int
    opened_at: datetime


@dataclass
class Portfolio:
    spread_rate: float
    cash: int = STARTING_CASH
    positions: dict[str, Position] = field(default_factory=dict)
    cumulative_fees: int = 0
    realized_pnl: int = 0
    fills: list[dict[str, Any]] = field(default_factory=list)

    def buy(self, market: str, next_open: float, at: datetime, score: float) -> None:
        if market in self.positions or len(self.positions) >= MAX_POSITIONS:
            return
        if MAX_OUTFLOW > self.cash - MINIMUM_CASH:
            return
        gross = math.floor(MAX_OUTFLOW / (1 + FEE_RATE))
        fee = math.floor(gross * FEE_RATE)
        outflow = gross + fee
        execution_price = next_open * (1 + self.spread_rate) * (1 + SLIPPAGE_RATE)
        units = math.floor((gross / execution_price) * UNITS_PER_COIN[market])
        if gross < 5_000 or units <= 0:
            return
        self.cash -= outflow
        self.cumulative_fees += fee
        self.positions[market] = Position(units, outflow, execution_price, fee, at)
        self.fills.append({
            "market": market, "side": "BUY", "time": at.isoformat(),
            "execution_price": execution_price, "gross": gross, "fee": fee,
            "cash_delta": -outflow, "score": score,
        })

    def sell(self, market: str, next_open: float, at: datetime, score: float) -> None:
        position = self.positions.get(market)
        if position is None:
            return
        execution_price = next_open * (1 - self.spread_rate) * (1 - SLIPPAGE_RATE)
        gross = math.floor((position.units / UNITS_PER_COIN[market]) * execution_price)
        fee = math.floor(gross * FEE_RATE)
        cash_delta = gross - fee
        realized = cash_delta - position.cost_basis
        self.cash += cash_delta
        self.cumulative_fees += fee
        self.realized_pnl += realized
        del self.positions[market]
        self.fills.append({
            "market": market, "side": "SELL", "time": at.isoformat(),
            "execution_price": execution_price, "gross": gross, "fee": fee,
            "cash_delta": cash_delta, "realized_pnl": realized, "score": score,
        })

    def equity(self, marks: dict[str, float]) -> int:
        value = self.cash
        for market, position in self.positions.items():
            value += math.floor((position.units / UNITS_PER_COIN[market]) * marks[market])
        return value


def run_case(data: dict[str, list[dict[str, Any]]], spread_rate: float) -> dict[str, Any]:
    histories: dict[str, list[dict[str, Any]]] = {market: [] for market in MARKETS}
    by_time = {market: {item["time"]: item for item in candles} for market, candles in data.items()}
    sorted_times = sorted({item["time"] for candles in data.values() for item in candles})
    next_candle = {
        market: {candles[index]["time"]: candles[index + 1] for index in range(len(candles) - 1)}
        for market, candles in data.items()
    }

    portfolio = Portfolio(spread_rate=spread_rate)
    equity_curve: list[tuple[datetime, int]] = []
    last_marks: dict[str, float] = {}

    for timestamp in sorted_times:
        decisions: list[dict[str, Any]] = []
        for market in MARKETS:
            candle = by_time[market].get(timestamp)
            if candle is None:
                continue
            histories[market].append(candle)
            last_marks[market] = candle["close"]
            if timestamp < START:
                continue
            evaluated = evaluate(histories[market], market in portfolio.positions)
            if evaluated["signal"] != "HOLD":
                decisions.append({"market": market, **evaluated})

        executable = []
        for decision in decisions:
            nxt = next_candle[decision["market"]].get(timestamp)
            if nxt is not None and nxt["time"] < END:
                executable.append((decision, nxt))

        for decision, nxt in [item for item in executable if item[0]["signal"] == "SELL"]:
            portfolio.sell(decision["market"], nxt["open"], nxt["time"], decision["score"]["total"])

        buys = [item for item in executable if item[0]["signal"] == "BUY"]
        buys.sort(key=lambda item: (-item[0]["score"]["rankingValue"], TIE_BREAK[item[0]["market"]]))
        for decision, nxt in buys:
            if len(portfolio.positions) >= MAX_POSITIONS:
                break
            portfolio.buy(decision["market"], nxt["open"], nxt["time"], decision["score"]["total"])

        if timestamp >= START and all(market in last_marks for market in portfolio.positions):
            equity_curve.append((timestamp, portfolio.equity(last_marks)))

    final_marks = {
        market: max((item for item in candles if item["time"] < END), key=lambda item: item["time"])["close"]
        for market, candles in data.items()
    }
    final_equity = portfolio.equity(final_marks)
    peak = STARTING_CASH
    max_drawdown = 0.0
    for _, equity in equity_curve:
        peak = max(peak, equity)
        if peak > 0:
            max_drawdown = min(max_drawdown, (equity - peak) / peak)

    sells = [fill for fill in portfolio.fills if fill["side"] == "SELL"]
    winning_sells = [fill for fill in sells if fill.get("realized_pnl", 0) > 0]
    per_market: dict[str, dict[str, Any]] = {}
    for market in MARKETS:
        market_fills = [fill for fill in portfolio.fills if fill["market"] == market]
        per_market[market] = {
            "fills": len(market_fills),
            "round_trips": sum(1 for fill in market_fills if fill["side"] == "SELL"),
            "realized_pnl": sum(fill.get("realized_pnl", 0) for fill in market_fills),
            "held_at_end": market in portfolio.positions,
        }

    return {
        "spread_rate_per_side": spread_rate,
        "final_equity_krw": final_equity,
        "profit_krw": final_equity - STARTING_CASH,
        "return_pct": round((final_equity / STARTING_CASH - 1) * 100, 4),
        "cash_krw": portfolio.cash,
        "open_positions": sorted(portfolio.positions),
        "realized_pnl_krw": portfolio.realized_pnl,
        "cumulative_fees_krw": portfolio.cumulative_fees,
        "fill_count": len(portfolio.fills),
        "completed_round_trips": len(sells),
        "win_rate_pct": round((len(winning_sells) / len(sells) * 100) if sells else 0.0, 2),
        "max_drawdown_pct": round(max_drawdown * 100, 4),
        "per_market": per_market,
        "first_fills": portfolio.fills[:5],
        "last_fills": portfolio.fills[-5:],
    }


def main() -> None:
    data = {market: fetch_market(market) for market in MARKETS}
    minimum_required = int((END - FETCH_START).total_seconds() // 60) - 10
    for market, candles in data.items():
        if len(candles) < minimum_required:
            raise RuntimeError(f"{market}: insufficient candles {len(candles)} < {minimum_required}")

    result = {
        "window": {
            "start_utc": START.isoformat(),
            "end_utc": END.isoformat(),
            "start_kst": (START + timedelta(hours=9)).isoformat(),
            "end_kst": (END + timedelta(hours=9)).isoformat(),
        },
        "strategy": {
            "markets": MARKETS,
            "starting_cash_krw": STARTING_CASH,
            "max_positions": MAX_POSITIONS,
            "max_outflow_per_position_krw": MAX_OUTFLOW,
            "minimum_cash_krw": MINIMUM_CASH,
            "fee_rate": FEE_RATE,
            "slippage_rate": SLIPPAGE_RATE,
            "sma_fast": FAST,
            "sma_slow": SLOW,
            "execution_proxy": "next available 1-minute candle open",
        },
        "candles": {market: len(candles) for market, candles in data.items()},
        "base": run_case(data, spread_rate=0.0),
        "conservative": run_case(data, spread_rate=0.0005),
    }
    with open("backtest-result.json", "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print("BACKTEST_RESULT_BEGIN")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("BACKTEST_RESULT_END")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"BACKTEST_ERROR: {exc}", file=sys.stderr)
        raise
