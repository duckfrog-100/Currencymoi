from __future__ import annotations

from collections.abc import Sequence

import pandas as pd
import plotly.graph_objects as go

from .models import Candle, Fill, Side


def build_price_chart(
    candles: Sequence[Candle],
    trades: Sequence[Fill],
    fast_period: int,
    slow_period: int,
) -> go.Figure:
    figure = go.Figure()
    figure.update_layout(
        title="KRW-BTC 실시간 데이터가 쌓이면 차트가 표시됩니다.",
        xaxis_title="시간",
        yaxis_title="가격 (KRW)",
        xaxis_rangeslider_visible=False,
        legend_orientation="h",
        margin=dict(l=10, r=10, t=50, b=10),
        height=520,
    )
    if not candles:
        return figure

    frame = pd.DataFrame(
        {
            "time": [candle.start_time for candle in candles],
            "open": [float(candle.open) for candle in candles],
            "high": [float(candle.high) for candle in candles],
            "low": [float(candle.low) for candle in candles],
            "close": [float(candle.close) for candle in candles],
        }
    )
    frame["fast"] = frame["close"].rolling(fast_period).mean()
    frame["slow"] = frame["close"].rolling(slow_period).mean()

    figure.add_trace(
        go.Candlestick(
            x=frame["time"],
            open=frame["open"],
            high=frame["high"],
            low=frame["low"],
            close=frame["close"],
            name="KRW-BTC",
        )
    )
    figure.add_trace(
        go.Scatter(x=frame["time"], y=frame["fast"], mode="lines", name=f"SMA {fast_period}")
    )
    figure.add_trace(
        go.Scatter(x=frame["time"], y=frame["slow"], mode="lines", name=f"SMA {slow_period}")
    )

    buys = [trade for trade in trades if trade.side is Side.BUY]
    sells = [trade for trade in trades if trade.side is Side.SELL]
    figure.add_trace(
        go.Scatter(
            x=[trade.candle_start for trade in buys],
            y=[float(trade.execution_price) for trade in buys],
            mode="markers",
            marker_symbol="triangle-up",
            marker_size=12,
            name="가상 매수",
            text=[trade.reason for trade in buys],
            hovertemplate="%{x}<br>%{y:,.0f}원<br>%{text}<extra></extra>",
        )
    )
    figure.add_trace(
        go.Scatter(
            x=[trade.candle_start for trade in sells],
            y=[float(trade.execution_price) for trade in sells],
            mode="markers",
            marker_symbol="triangle-down",
            marker_size=12,
            name="가상 매도",
            text=[trade.reason for trade in sells],
            hovertemplate="%{x}<br>%{y:,.0f}원<br>%{text}<extra></extra>",
        )
    )
    figure.update_layout(title=f"KRW-BTC · SMA {fast_period}/{slow_period}")
    return figure
