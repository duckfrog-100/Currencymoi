# Currencymoi Paper Trading Bot Design

## 1. Goal

Build a local-first web dashboard that consumes Upbit's public real-time KRW-BTC market data and simulates automatic trades using an initial virtual balance of 50,000 KRW. The application must never create a real exchange order or require an exchange API key.

## 2. MVP Scope

### Included

- Upbit public WebSocket market data for `KRW-BTC`
- Live ticker and order-book display
- One-minute candle aggregation
- Five-period and twenty-period simple moving averages
- Long-only moving-average crossover strategy
- Virtual wallet starting with 50,000 KRW
- One open BTC position at a time
- Simulated fees and slippage
- Persistent portfolio, bot state, candles, and trades in SQLite
- Streamlit dashboard with live metrics, chart, trades, logs, and controls
- Normal mode using one-minute candles
- Demo mode using five-second candles and shorter moving averages so users can see simulated actions sooner
- Automated tests for strategy, broker, portfolio, persistence, and candle aggregation

### Excluded

- Real orders or private exchange APIs
- Exchange API keys
- Withdrawals, deposits, or custody
- Multiple users or authentication
- Paid subscriptions
- Multiple exchanges or multiple assets
- AI price prediction
- Short selling, leverage, futures, or margin

## 3. Default Trading Rules

### Normal mode

- Market: `KRW-BTC`
- Starting cash: 50,000 KRW
- Buy budget: 40,000 KRW
- Minimum remaining cash: 10,000 KRW
- Candle interval: 60 seconds
- Fast moving average: 5 completed candles
- Slow moving average: 20 completed candles
- Buy: fast SMA crosses above slow SMA while flat
- Sell: fast SMA crosses below slow SMA while holding BTC
- Fee rate: 0.05 percent per side
- Slippage rate: 0.02 percent per side

### Demo mode

- Candle interval: 5 seconds
- Fast moving average: 3 completed candles
- Slow moving average: 7 completed candles
- All other portfolio and execution rules remain identical

A signal is calculated only when a candle is finalized. At most one order may be created from a single finalized candle.

## 4. Simulated Execution

For a buy, the broker uses the best ask plus configured slippage. The fee is deducted from the buy budget before calculating acquired BTC.

For a sell, the broker uses the best bid minus configured slippage. The fee is deducted from gross sale proceeds.

The broker rejects an order when:

- market data is stale or missing
- price is zero or negative
- the bot is paused
- the same candle was already processed
- a buy is requested while a position is already open
- a sell is requested while flat
- available cash is insufficient

All monetary calculations use `Decimal` and explicit quantization. Floating-point arithmetic is not used for wallet or execution values.

## 5. Architecture

The application is a Python package with a Streamlit entry point.

- `market_data`: maintains a reconnecting Upbit public WebSocket client and publishes normalized ticker/order-book events
- `candle_builder`: aggregates real-time prices into completed interval candles
- `strategy`: calculates moving averages and emits BUY, SELL, or HOLD decisions
- `paper_broker`: applies fee and slippage rules and returns deterministic simulated fills
- `portfolio`: owns cash, BTC quantity, average entry, realized PnL, and valuation calculations
- `repository`: persists settings, bot state, candles, fills, decisions, and equity snapshots in SQLite
- `engine`: coordinates market events, completed candles, strategy decisions, broker fills, and persistence
- `dashboard`: renders Streamlit metrics, chart, trade history, event log, and controls

The trading engine runs in one background thread per Streamlit process. A cached runtime object prevents duplicate engine starts caused by Streamlit reruns.

## 6. Data Flow

1. Upbit WebSocket sends ticker and order-book messages.
2. The market client normalizes them and updates a thread-safe market snapshot.
3. Trade prices are passed to the candle builder.
4. When a candle closes, it is persisted and sent to the strategy.
5. The strategy emits a decision with a human-readable reason.
6. The engine validates bot state and deduplicates the candle.
7. The paper broker computes a simulated fill from best bid or best ask.
8. The portfolio applies the fill and recalculates equity and PnL.
9. The repository stores the decision, fill, bot state, and equity snapshot atomically.
10. Streamlit reads immutable runtime snapshots and renders the dashboard.

## 7. Persistence

SQLite is stored at `data/currencymoi.db`. Tables:

- `settings`: active mode and configurable strategy/execution values
- `bot_state`: running status, cash, BTC quantity, average entry, realized PnL, and last processed candle
- `candles`: interval, start time, OHLC, and volume
- `decisions`: timestamp, candle start, signal, reason, fast SMA, and slow SMA
- `trades`: side, quantity, execution price, gross amount, fee, realized PnL, reason, and candle start
- `equity_snapshots`: cash, BTC value, total equity, and unrealized/realized PnL

Database initialization is idempotent. On startup, the bot restores the latest state. Reset deletes trading history and recreates the initial 50,000 KRW state while preserving schema.

## 8. Dashboard

The dashboard displays:

- live BTC price, best bid, best ask, and connection state
- total equity, cash, BTC value, total PnL, return percentage, and realized PnL
- bot running/paused state, mode, position, last decision, and last action
- candlestick chart with fast/slow SMA and buy/sell markers
- recent trades with execution details and reasons
- recent decisions and system events
- controls for start, pause, reset, mode, fee, slippage, buy budget, and moving-average periods

Reset requires an explicit confirmation checkbox because it removes simulated history.

## 9. Failure Handling

- WebSocket disconnect: mark data disconnected, stop trading, reconnect with capped exponential backoff
- Stale market snapshot: continue displaying the last price but reject new trades
- Invalid exchange payload: record a warning and ignore the payload
- SQLite error during a trade: roll back the transaction and do not mutate the in-memory portfolio
- Duplicate Streamlit rerun: reuse the cached engine instead of creating another thread
- Insufficient candle history: emit HOLD with an explanatory reason
- Unexpected engine exception: pause the bot, record the error, and keep the dashboard available

## 10. Testing

Unit tests cover:

- candle rollover and OHLC aggregation
- crossover detection and insufficient-history behavior
- fee/slippage fill calculations
- buy/sell portfolio mutations and realized PnL
- duplicate-candle protection
- SQLite restore and reset
- stale-market rejection

Integration tests run the engine with a fake market feed and temporary SQLite database. No test contacts Upbit.

## 11. Completion Criteria

The MVP is complete when:

1. Live KRW-BTC price and order book appear in the browser.
2. Candles and moving averages update continuously.
3. Normal and demo modes both operate.
4. The bot automatically creates simulated fills from crossover signals.
5. Portfolio metrics reflect fees and slippage.
6. Trades and decisions are persisted and restored after restart.
7. Reset reliably restores a 50,000 KRW account.
8. Automated tests pass without network access.
9. The code contains no real-order endpoint, API-key field, or private Upbit authentication logic.
