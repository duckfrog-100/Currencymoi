#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import timedelta

import backtest_last_30d as bt


def main() -> None:
    data = {market: bt.fetch_market(market) for market in bt.MARKETS}

    for market, candles in data.items():
        warmup = [item for item in candles if item["time"] < bt.START]
        in_window = [item for item in candles if bt.START <= item["time"] < bt.END]
        if len(warmup) < bt.SLOW + 1:
            raise RuntimeError(f"{market}: insufficient warmup candles {len(warmup)}")
        if not in_window:
            raise RuntimeError(f"{market}: no candles in backtest window")

    result = {
        "window": {
            "start_utc": bt.START.isoformat(),
            "end_utc": bt.END.isoformat(),
            "start_kst": (bt.START + timedelta(hours=9)).isoformat(),
            "end_kst": (bt.END + timedelta(hours=9)).isoformat(),
        },
        "strategy": {
            "markets": bt.MARKETS,
            "starting_cash_krw": bt.STARTING_CASH,
            "max_positions": bt.MAX_POSITIONS,
            "max_outflow_per_position_krw": bt.MAX_OUTFLOW,
            "minimum_cash_krw": bt.MINIMUM_CASH,
            "fee_rate": bt.FEE_RATE,
            "slippage_rate": bt.SLIPPAGE_RATE,
            "sma_fast": bt.FAST,
            "sma_slow": bt.SLOW,
            "execution_proxy": "next available 1-minute candle open",
            "missing_minutes": "left absent, matching Upbit and live CandleBuilder behavior",
        },
        "candles": {market: len(candles) for market, candles in data.items()},
        "base": bt.run_case(data, spread_rate=0.0),
        "conservative": bt.run_case(data, spread_rate=0.0005),
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
