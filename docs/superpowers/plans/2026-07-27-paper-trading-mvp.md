# Paper Trading MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested Streamlit application that displays live Upbit KRW-BTC data and simulates automatic trades from a 50,000 KRW virtual wallet without any real-order capability.

**Architecture:** A background trading engine consumes normalized public market events, aggregates completed candles, evaluates a moving-average crossover strategy, simulates fills through a deterministic paper broker, updates a Decimal-based portfolio, and persists state in SQLite. Streamlit reads thread-safe runtime snapshots and provides start, pause, mode, settings, and reset controls.

**Tech Stack:** Python 3.11+, Streamlit, pandas, Plotly, websocket-client, SQLite, pytest

## Global Constraints

- The application must never call a private Upbit endpoint or create a real exchange order.
- No API key, secret key, withdrawal, deposit, custody, leverage, futures, or short-selling feature is permitted.
- Default market is `KRW-BTC`.
- Default starting cash is exactly `50000` KRW.
- Default buy budget is exactly `40000` KRW.
- Wallet and fill calculations use `decimal.Decimal`, never binary floating point.
- Normal mode uses 60-second candles with SMA 5 and SMA 20.
- Demo mode uses 5-second candles with SMA 3 and SMA 7.
- New signals are evaluated only on finalized candles.
- One finalized candle may produce at most one simulated order.
- All automated tests must run without network access.

---

## File Structure

- `app.py`: Streamlit entry point and dashboard layout
- `requirements.txt`: runtime dependencies
- `requirements-dev.txt`: test dependencies
- `.gitignore`: Python, SQLite, cache, and environment exclusions
- `README.md`: setup, run, safety, and usage instructions
- `currencymoi/__init__.py`: package metadata
- `currencymoi/config.py`: typed normal/demo configuration
- `currencymoi/models.py`: immutable market, candle, signal, fill, and snapshot models
- `currencymoi/candle_builder.py`: interval candle aggregation
- `currencymoi/strategy.py`: SMA crossover decisions
- `currencymoi/paper_broker.py`: fee/slippage simulated execution
- `currencymoi/portfolio.py`: virtual wallet mutations and valuation
- `currencymoi/repository.py`: SQLite schema and atomic persistence
- `currencymoi/market_data.py`: reconnecting Upbit public WebSocket client
- `currencymoi/engine.py`: thread-safe orchestration and runtime snapshots
- `currencymoi/charts.py`: Plotly chart construction
- `tests/test_candle_builder.py`: aggregation tests
- `tests/test_strategy.py`: signal tests
- `tests/test_paper_broker.py`: simulated fill tests
- `tests/test_portfolio.py`: wallet and PnL tests
- `tests/test_repository.py`: restore/reset tests
- `tests/test_engine.py`: orchestration and duplicate/stale protection tests

---

### Task 1: Domain Models and Configuration

**Files:**
- Create: `currencymoi/__init__.py`
- Create: `currencymoi/config.py`
- Create: `currencymoi/models.py`
- Create: `tests/test_config.py`

**Interfaces:**
- Produces: `BotConfig`, `TradingMode`, `Side`, `Signal`, `MarketSnapshot`, `Candle`, `Decision`, `Fill`, `PortfolioSnapshot`

- [ ] **Step 1: Write failing configuration tests**

```python
from decimal import Decimal
from currencymoi.config import BotConfig, TradingMode


def test_normal_mode_defaults_are_safe():
    config = BotConfig.for_mode(TradingMode.NORMAL)
    assert config.starting_cash == Decimal("50000")
    assert config.buy_budget == Decimal("40000")
    assert config.candle_seconds == 60
    assert (config.fast_period, config.slow_period) == (5, 20)


def test_demo_mode_uses_short_intervals():
    config = BotConfig.for_mode(TradingMode.DEMO)
    assert config.candle_seconds == 5
    assert (config.fast_period, config.slow_period) == (3, 7)
```

- [ ] **Step 2: Run tests and verify import failure**

Run: `pytest tests/test_config.py -v`
Expected: FAIL because `currencymoi.config` does not exist.

- [ ] **Step 3: Implement typed enums, dataclasses, and validated defaults**

Implement `TradingMode(str, Enum)`, `Side(str, Enum)`, `Signal(str, Enum)`, frozen dataclasses, and `BotConfig.for_mode()` with positive-value and fast-period-less-than-slow-period validation.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_config.py -v`
Expected: PASS.

### Task 2: Candle Aggregation and Strategy

**Files:**
- Create: `currencymoi/candle_builder.py`
- Create: `currencymoi/strategy.py`
- Create: `tests/test_candle_builder.py`
- Create: `tests/test_strategy.py`

**Interfaces:**
- Consumes: `Candle`, `Decision`, `Signal`
- Produces: `CandleBuilder.add_trade(timestamp, price, volume) -> Candle | None`
- Produces: `MovingAverageCrossover.evaluate(candles, has_position) -> Decision`

- [ ] **Step 1: Write failing candle rollover tests**

```python
from datetime import datetime, timezone
from decimal import Decimal
from currencymoi.candle_builder import CandleBuilder


def test_builder_returns_completed_candle_on_interval_rollover():
    builder = CandleBuilder(interval_seconds=60)
    assert builder.add_trade(datetime(2026, 7, 27, 0, 0, 1, tzinfo=timezone.utc), Decimal("100"), Decimal("1")) is None
    assert builder.add_trade(datetime(2026, 7, 27, 0, 0, 30, tzinfo=timezone.utc), Decimal("110"), Decimal("2")) is None
    candle = builder.add_trade(datetime(2026, 7, 27, 0, 1, 0, tzinfo=timezone.utc), Decimal("105"), Decimal("1"))
    assert (candle.open, candle.high, candle.low, candle.close, candle.volume) == (
        Decimal("100"), Decimal("110"), Decimal("100"), Decimal("110"), Decimal("3")
    )
```

- [ ] **Step 2: Verify RED, then implement the smallest interval bucket aggregator**

Run: `pytest tests/test_candle_builder.py -v`
Expected before implementation: FAIL; after implementation: PASS.

- [ ] **Step 3: Write failing strategy tests for insufficient history and crossovers**

Create candles with close prices `[10, 10, 10, 10, 10, 9, 12]` for a 3/5 strategy and assert the final transition emits BUY only when flat. Add the inverse sequence and assert SELL only when holding.

- [ ] **Step 4: Implement SMA calculation using completed candles only**

The decision reason must include the prior and current fast/slow values. HOLD is returned when history is insufficient or the position state makes the crossing non-actionable.

- [ ] **Step 5: Run focused tests**

Run: `pytest tests/test_candle_builder.py tests/test_strategy.py -v`
Expected: PASS.

### Task 3: Paper Broker and Portfolio

**Files:**
- Create: `currencymoi/paper_broker.py`
- Create: `currencymoi/portfolio.py`
- Create: `tests/test_paper_broker.py`
- Create: `tests/test_portfolio.py`

**Interfaces:**
- Consumes: `BotConfig`, `Side`, `Fill`, `MarketSnapshot`
- Produces: `PaperBroker.buy(budget, best_ask, timestamp, reason, candle_start) -> Fill`
- Produces: `PaperBroker.sell(quantity, best_bid, timestamp, reason, candle_start) -> Fill`
- Produces: `Portfolio.apply_fill(fill) -> None`
- Produces: `Portfolio.snapshot(mark_price) -> PortfolioSnapshot`

- [ ] **Step 1: Write failing buy-fill arithmetic test**

For budget `40000`, ask `100000000`, fee `0.0005`, and slippage `0.0002`, assert execution price `100020000`, fee `20`, and quantity `(39980 / 100020000)` using Decimal equality after explicit quantization.

- [ ] **Step 2: Implement deterministic fill calculations and validation**

Reject non-positive prices, budgets, and quantities. Buy uses ask multiplied by `1 + slippage`; sell uses bid multiplied by `1 - slippage`.

- [ ] **Step 3: Write failing portfolio tests**

Assert a 50,000 KRW portfolio becomes 10,000 KRW cash plus the acquired BTC after a 40,000 KRW buy. Assert a later sell returns to flat, records realized PnL, and never produces negative cash or BTC.

- [ ] **Step 4: Implement portfolio mutation and valuation**

Maintain starting cash, cash, BTC quantity, average entry price, realized PnL, and last fill. Total PnL equals total equity minus starting cash.

- [ ] **Step 5: Run focused tests**

Run: `pytest tests/test_paper_broker.py tests/test_portfolio.py -v`
Expected: PASS.

### Task 4: SQLite Persistence

**Files:**
- Create: `currencymoi/repository.py`
- Create: `tests/test_repository.py`

**Interfaces:**
- Consumes: `BotConfig`, `Candle`, `Decision`, `Fill`, `Portfolio`
- Produces: `SQLiteRepository.initialize()`, `load_state()`, `save_candle()`, `save_decision()`, `save_trade_and_state()`, `list_candles()`, `list_trades()`, `list_decisions()`, `reset()`

- [ ] **Step 1: Write failing restore test with a temporary database**

Initialize the database, save a buy fill and state, create a second repository instance, and assert the restored cash, BTC quantity, and last processed candle match.

- [ ] **Step 2: Implement idempotent schema creation and Decimal text serialization**

Use SQLite transactions. Store Decimal values as canonical strings. Apply a uniqueness constraint to `(interval_seconds, start_time)` in candles and to `candle_start` in trades for duplicate-order protection.

- [ ] **Step 3: Write failing reset test**

After storing candles, decisions, and trades, call `reset(Decimal("50000"))` and assert history is empty and state is flat with exactly 50,000 KRW cash.

- [ ] **Step 4: Implement reset as one transaction**

Delete history rows, replace bot state, and preserve settings/schema.

- [ ] **Step 5: Run focused tests**

Run: `pytest tests/test_repository.py -v`
Expected: PASS.

### Task 5: Trading Engine and Public Market Client

**Files:**
- Create: `currencymoi/market_data.py`
- Create: `currencymoi/engine.py`
- Create: `tests/test_engine.py`

**Interfaces:**
- Consumes: all prior domain interfaces
- Produces: `UpbitPublicWebSocket.start(on_snapshot, on_trade, on_event)`, `stop()`
- Produces: `TradingEngine.start()`, `pause()`, `reset()`, `change_mode()`, `snapshot()`

- [ ] **Step 1: Write failing engine tests using a fake market feed**

Inject completed candles and current order-book snapshots. Assert that BUY and SELL decisions mutate the portfolio once, that replaying the same candle does not create another trade, and that stale snapshots reject execution.

- [ ] **Step 2: Implement synchronous engine event handlers first**

Implement `process_market_snapshot()`, `process_trade_tick()`, and `process_completed_candle()` independently of threads. Persist a decision for every completed candle and atomically persist fills with state.

- [ ] **Step 3: Add thread-safe lifecycle**

Use `threading.RLock`, `threading.Event`, and one daemon thread for the public WebSocket. `start()` must be idempotent, `pause()` must stop simulated execution without stopping display updates, and `reset()` must be rejected while an execution is in progress.

- [ ] **Step 4: Implement Upbit public WebSocket adapter**

Connect to the public endpoint, subscribe to ticker, trade, and order-book for `KRW-BTC`, normalize messages, reject malformed payloads, and reconnect with capped exponential backoff. No authentication header or private channel may exist.

- [ ] **Step 5: Run engine tests without network access**

Run: `pytest tests/test_engine.py -v`
Expected: PASS.

### Task 6: Streamlit Dashboard, Chart, and Documentation

**Files:**
- Create: `currencymoi/charts.py`
- Create: `app.py`
- Create: `requirements.txt`
- Create: `requirements-dev.txt`
- Create: `.gitignore`
- Create: `README.md`
- Create: `tests/test_charts.py`

**Interfaces:**
- Consumes: `TradingEngine.snapshot()` and repository listing methods
- Produces: `build_price_chart(candles, trades, fast_period, slow_period) -> plotly.graph_objects.Figure`

- [ ] **Step 1: Write a failing chart construction test**

Create sample candles and trades and assert the figure contains candlestick, fast SMA, slow SMA, buy-marker, and sell-marker traces.

- [ ] **Step 2: Implement chart builder**

Use Plotly graph objects and pandas rolling averages. The chart function must be pure and must not access Streamlit state.

- [ ] **Step 3: Implement Streamlit runtime caching and dashboard**

Use `@st.cache_resource` for one repository and engine instance. Render connection, market, portfolio, strategy, trades, decisions, and events. Provide start, pause, mode, settings, CSV download, and confirmation-protected reset controls.

- [ ] **Step 4: Add packaging and run instructions**

`requirements.txt` contains pinned compatible lower bounds for Streamlit, pandas, Plotly, and websocket-client. `requirements-dev.txt` adds pytest. README explicitly states that no real orders are possible and provides Windows PowerShell and macOS/Linux commands.

- [ ] **Step 5: Run all tests and compile checks**

Run: `pytest -q`
Expected: all tests pass.

Run: `python -m compileall currencymoi app.py`
Expected: exit code 0.

- [ ] **Step 6: Smoke-start Streamlit**

Run: `streamlit run app.py --server.headless true --server.port 8501`
Expected: server starts without import or database errors; stop it after the startup check.

### Task 7: Safety and Final Verification

**Files:**
- Inspect: all project files

- [ ] **Step 1: Search for prohibited real-trading features**

Run: `grep -RniE "access[_ -]?key|secret[_ -]?key|authorization|/v1/orders|withdraw|deposit" --exclude-dir=.git .`
Expected: no production-code matches implementing API keys or private order endpoints; documentation safety wording may match.

- [ ] **Step 2: Run the complete verification suite again**

Run: `pytest -q && python -m compileall currencymoi app.py`
Expected: exit code 0.

- [ ] **Step 3: Review the final diff**

Confirm only the paper-trading MVP, tests, documentation, design, and plan are present.

- [ ] **Step 4: Create a focused commit and draft pull request**

Commit message: `feat: add real-time paper trading MVP`

Draft PR title: `feat: add real-time paper trading MVP`

PR body must summarize architecture, safety boundary, normal/demo modes, persistence, dashboard, and exact verification results.
