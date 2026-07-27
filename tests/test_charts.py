from datetime import datetime, timedelta, timezone
from decimal import Decimal

from currencymoi.charts import build_price_chart
from currencymoi.models import Candle, Fill, Side


START = datetime(2026, 7, 27, tzinfo=timezone.utc)


def test_chart_contains_price_averages_and_trade_markers():
    candles = []
    for index, close in enumerate([100, 101, 102, 101, 103, 104]):
        price = Decimal(str(close))
        candles.append(
            Candle(
                start_time=START + timedelta(minutes=index),
                interval_seconds=60,
                open=price - 1,
                high=price + 1,
                low=price - 2,
                close=price,
                volume=Decimal("1"),
            )
        )
    trades = [
        Fill(START + timedelta(minutes=3), START + timedelta(minutes=2), Side.BUY, Decimal("0.1"), Decimal("102"), Decimal("10.2"), Decimal("0"), Decimal("10.2"), "buy"),
        Fill(START + timedelta(minutes=6), START + timedelta(minutes=5), Side.SELL, Decimal("0.1"), Decimal("104"), Decimal("10.4"), Decimal("0"), Decimal("10.4"), "sell"),
    ]

    figure = build_price_chart(candles, trades, fast_period=2, slow_period=3)

    names = [trace.name for trace in figure.data]
    assert names == ["KRW-BTC", "SMA 2", "SMA 3", "가상 매수", "가상 매도"]
    assert len(figure.data[0].x) == 6


def test_chart_handles_empty_history():
    figure = build_price_chart([], [], fast_period=3, slow_period=7)

    assert len(figure.data) == 0
    assert "실시간 데이터" in figure.layout.title.text
