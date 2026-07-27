from __future__ import annotations

import atexit
import time
from decimal import Decimal
from pathlib import Path

import pandas as pd
import streamlit as st

from currencymoi.charts import build_price_chart
from currencymoi.config import BotConfig, TradingMode
from currencymoi.engine import TradingEngine
from currencymoi.models import Fill
from currencymoi.repository import SQLiteRepository


st.set_page_config(
    page_title="Currencymoi · 실시간 모의투자봇",
    page_icon="₿",
    layout="wide",
)

DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "currencymoi.db"


@st.cache_resource
def get_runtime() -> tuple[TradingEngine, SQLiteRepository]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    repository = SQLiteRepository(DB_PATH)
    engine = TradingEngine(BotConfig.for_mode(TradingMode.NORMAL), repository)
    engine.connect_market()
    atexit.register(engine.shutdown)
    return engine, repository


def format_krw(value: Decimal) -> str:
    return f"{value:,.0f}원"


def format_rate(value: Decimal) -> str:
    return f"{value * Decimal('100'):+.2f}%"


def trades_frame(trades: list[Fill]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "시간": trade.timestamp.astimezone().strftime("%Y-%m-%d %H:%M:%S"),
                "구분": "매수" if trade.side.value == "BUY" else "매도",
                "체결가": float(trade.execution_price),
                "수량(BTC)": float(trade.quantity),
                "거래금액": float(trade.gross_amount),
                "수수료": float(trade.fee),
                "실현손익": float(trade.realized_pnl),
                "이유": trade.reason,
            }
            for trade in trades
        ]
    )


engine, repository = get_runtime()

st.title("Currencymoi")
st.subheader("실시간 가상화폐 모의투자봇")
st.warning(
    "이 프로그램은 업비트 공개 시세만 사용하며 실제 주문 기능이 없습니다. "
    "API 키를 입력하거나 실제 자산을 입금할 필요가 없습니다."
)

with st.sidebar:
    st.header("봇 제어")
    control_left, control_right = st.columns(2)
    if control_left.button("▶ 시작", use_container_width=True):
        try:
            engine.start()
            st.rerun()
        except Exception as exc:
            st.error(str(exc))
    if control_right.button("Ⅱ 일시정지", use_container_width=True):
        try:
            engine.pause()
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    current_mode = TradingMode(engine.config.mode)
    selected_mode = st.selectbox(
        "전략 모드",
        options=list(TradingMode),
        index=list(TradingMode).index(current_mode),
        format_func=lambda mode: "일반 · 1분봉 SMA 5/20" if mode is TradingMode.NORMAL else "데모 · 5초봉 SMA 3/7",
    )
    if st.button("모드 적용", use_container_width=True):
        try:
            engine.change_mode(selected_mode)
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    st.divider()
    st.header("가상 체결 설정")
    buy_budget = st.number_input(
        "1회 매수금액(원)",
        min_value=1000,
        max_value=40000,
        value=int(engine.config.buy_budget),
        step=1000,
    )
    fee_percent = st.number_input(
        "가상 수수료(%)",
        min_value=0.0,
        max_value=1.0,
        value=float(engine.config.fee_rate * Decimal("100")),
        step=0.01,
        format="%.2f",
    )
    slippage_percent = st.number_input(
        "가상 슬리피지(%)",
        min_value=0.0,
        max_value=1.0,
        value=float(engine.config.slippage_rate * Decimal("100")),
        step=0.01,
        format="%.2f",
    )
    if st.button("설정 적용", use_container_width=True):
        try:
            engine.update_execution_settings(
                buy_budget=Decimal(str(buy_budget)),
                fee_rate=Decimal(str(fee_percent)) / Decimal("100"),
                slippage_rate=Decimal(str(slippage_percent)) / Decimal("100"),
            )
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    st.divider()
    confirm_reset = st.checkbox("거래 기록 삭제에 동의합니다")
    if st.button("50,000원으로 초기화", disabled=not confirm_reset, use_container_width=True):
        try:
            engine.reset()
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    auto_refresh = st.toggle("1초마다 자동 새로고침", value=True)

snapshot = engine.snapshot()
market = snapshot.market
portfolio = snapshot.portfolio

status_columns = st.columns(4)
status_columns[0].metric("봇 상태", "실행 중" if snapshot.running else "일시정지")
status_columns[1].metric("시세 연결", snapshot.connection_status)
status_columns[2].metric("전략 모드", "일반" if snapshot.mode == "normal" else "데모")
status_columns[3].metric("현재 포지션", "BTC 보유" if portfolio.has_position else "현금 보유")

market_columns = st.columns(3)
market_columns[0].metric("BTC 현재가", format_krw(market.trade_price) if market else "연결 대기")
market_columns[1].metric("최우선 매수호가", format_krw(market.best_bid) if market else "-")
market_columns[2].metric("최우선 매도호가", format_krw(market.best_ask) if market else "-")

asset_columns = st.columns(6)
asset_columns[0].metric("총 평가자산", format_krw(portfolio.total_equity), delta=format_krw(portfolio.total_pnl))
asset_columns[1].metric("보유 현금", format_krw(portfolio.cash))
asset_columns[2].metric("BTC 평가금액", format_krw(portfolio.btc_value))
asset_columns[3].metric("BTC 수량", f"{portfolio.btc_quantity:.8f}")
asset_columns[4].metric("누적 수익률", format_rate(portfolio.return_rate))
asset_columns[5].metric("실현손익", format_krw(portfolio.realized_pnl))

last_decision_text = snapshot.last_decision.reason if snapshot.last_decision else "완료된 봉을 기다리는 중입니다."
last_action_text = (
    f"{snapshot.last_fill.side.value} · {format_krw(snapshot.last_fill.gross_amount)}"
    if snapshot.last_fill
    else "아직 가상 거래가 없습니다."
)
info_left, info_right = st.columns(2)
info_left.info(f"최근 판단: {last_decision_text}")
info_right.info(f"최근 행동: {last_action_text}")

candles = repository.list_candles(engine.config.candle_seconds, limit=300)
trades = repository.list_trades(limit=100)
figure = build_price_chart(candles, list(reversed(trades)), engine.config.fast_period, engine.config.slow_period)
st.plotly_chart(figure, use_container_width=True)

trade_tab, decision_tab, event_tab = st.tabs(["거래 내역", "전략 판단", "시스템 로그"])
with trade_tab:
    frame = trades_frame(trades)
    if frame.empty:
        st.info("아직 체결된 가상 거래가 없습니다.")
    else:
        st.dataframe(frame, use_container_width=True, hide_index=True)
        st.download_button(
            "거래 내역 CSV 다운로드",
            data=frame.to_csv(index=False).encode("utf-8-sig"),
            file_name="currencymoi-paper-trades.csv",
            mime="text/csv",
        )

with decision_tab:
    decisions = repository.list_decisions(limit=100)
    if not decisions:
        st.info("완료된 봉이 생기면 판단 기록이 표시됩니다.")
    else:
        decision_frame = pd.DataFrame(
            [
                {
                    "시간": decision.timestamp.astimezone().strftime("%Y-%m-%d %H:%M:%S"),
                    "신호": decision.signal.value,
                    "단기 SMA": None if decision.fast_sma is None else float(decision.fast_sma),
                    "장기 SMA": None if decision.slow_sma is None else float(decision.slow_sma),
                    "판단 이유": decision.reason,
                }
                for decision in decisions
            ]
        )
        st.dataframe(decision_frame, use_container_width=True, hide_index=True)

with event_tab:
    if snapshot.event_messages:
        st.code("\n".join(snapshot.event_messages), language=None)
    else:
        st.info("시스템 이벤트가 아직 없습니다.")

st.caption(
    "일반 모드는 1분봉 SMA 5/20, 데모 모드는 5초봉 SMA 3/7을 사용합니다. "
    "데모 모드는 거래 장면 확인용이며 수익성을 보장하지 않습니다."
)

if auto_refresh:
    time.sleep(1)
    st.rerun()
