# Currencymoi Multi-Coin Portfolio Design

## 1. Goal

Expand the GitHub Pages paper-trading dashboard from a single KRW-BTC position into one shared 50,000 KRW portfolio that watches and trades five fixed KRW markets:

- KRW-BTC
- KRW-ETH
- KRW-XRP
- KRW-SOL
- KRW-DOGE

The product remains paper-trading only. It must not contain API keys, authenticated exchange endpoints, real orders, deposits, withdrawals, leverage, derivatives, custody, or investment-advice claims.

## 2. Confirmed Product Decisions

### Shared wallet

- Starting virtual cash: 50,000 KRW
- Shared by all five markets
- Maximum simultaneous positions: 2
- Maximum total cash outflow per new position: 20,000 KRW, including the buy fee
- Minimum remaining cash after a buy: 10,000 KRW
- Minimum simulated order value: 5,000 KRW

### Fees and execution

- Default fee rate: 0.05 percent
- Fee rate is editable in the web UI and persisted in localStorage
- Allowed UI range: 0.00 to 1.00 percent, step 0.01 percentage point
- Buy simulation uses the best ask plus configured slippage
- Sell simulation uses the best bid minus configured slippage
- Existing default slippage remains 0.02 percent
- Buy fee is added to the asset purchase amount but total cash outflow may not exceed 20,000 KRW
- Sell fee is deducted from gross sale proceeds
- The dashboard shows cumulative fees and per-fill fees

For a buy with a 20,000 KRW total-outflow cap:

1. `assetSpend = floor(20,000 / (1 + feeRate))`
2. `fee = floor(assetSpend * feeRate)`
3. `cashOutflow = assetSpend + fee`
4. Any rounding remainder stays as cash

### Candidate ranking

Only markets with a new bullish moving-average crossover are buy candidates. When more candidates exist than open portfolio slots, candidates are ranked by a composite score:

- Moving-average breakout strength: 50 points
- Recent price momentum: 30 points
- Volume growth: 20 points

The score is calculated from completed candles only.

#### Moving-average score

- Raw metric: `(fastSma - slowSma) / slowSma`
- A non-positive value scores 0
- A value of 1 percent or more scores the full 50
- Values between 0 and 1 percent scale linearly

#### Momentum score

- Raw metric: return from the close three candles ago to the latest close
- A non-positive return scores 0
- A return of 3 percent or more scores the full 30
- Values between 0 and 3 percent scale linearly

#### Volume score

- Raw metric: latest candle volume divided by the average volume of the previous five completed candles
- A ratio of 1.0 or less scores 0
- A ratio of 3.0 or more scores the full 20
- Ratios between 1.0 and 3.0 scale linearly

Each component is rounded to two decimal places for display. The unrounded total is used for ranking.

### Portfolio decision order

At each aligned candle close:

1. Collect decisions for all five markets during a two-second grace window.
2. Process bearish crossover sells first.
3. Recalculate available cash and open slots.
4. Sort bullish crossover candidates by composite score descending.
5. Break exact score ties in this fixed order: BTC, ETH, XRP, SOL, DOGE.
6. Buy candidates until two positions are held or the minimum-cash rule blocks another buy.

A market may generate no more than one simulated fill for the same completed candle.

## 3. User Experience

The GitHub Pages app becomes a two-view single-page interface.

### Portfolio view

The portfolio view is the default screen and contains:

- Total equity
- Total return and total PnL
- Remaining cash
- Position count, shown as `0/2`, `1/2`, or `2/2`
- Cumulative fees
- Start, pause, reset, fee-rate setting, and data-source status
- Five market cards showing current price, position status, composite score, and current signal
- Current-position cards showing quantity, average entry, market value, unrealized PnL, return, buy fee, and current score
- Ranked strategy decisions with component-score explanations
- Combined trade history across all markets

Selecting a market card opens its detail view.

### Coin detail view

The detail view includes tabs for BTC, ETH, XRP, SOL, and DOGE. It shows:

- Selected market and Korean asset name
- Current price, best bid, and best ask
- Position status and position value
- Composite score and signal
- Price chart with fast SMA, slow SMA, and simulated fills
- Score breakdown for moving average, momentum, and volume
- Simulated order-cost calculation using the current editable fee rate
- Recent fills and decisions for the selected market

A persistent navigation control returns to the portfolio view.

### Mobile behavior

- Summary cards use a two-column layout and collapse to one column on narrow screens
- Market cards use a horizontally scrollable row only when five readable cards cannot fit
- Tables are replaced by stacked fill and decision cards below 680 CSS pixels
- Primary controls remain visible without horizontal page scrolling

## 4. Market Data Architecture

### WebSocket-first mode

Use one public Upbit WebSocket connection for all five markets. Subscribe in one request to:

- ticker for all five markets
- trade for all five markets
- orderbook with one level for all five markets

Normalize every event by market code and route it to that market's candle builder, quote snapshot, and UI card.

### Browser REST fallback

Browser requests include an Origin header and share a one-request-per-ten-seconds quotation limit. The fallback therefore uses one batch request at a time and includes all five markets in each request.

Alternate every 10.5 seconds between:

1. Batch orderbook request for all five markets
2. Batch ticker request for all five markets

Each endpoint is therefore refreshed about every 21 seconds while the overall browser request rate remains within the Origin limit.

- Orderbook supplies best bid and best ask.
- Ticker supplies trade price and cumulative 24-hour volume.
- Volume deltas between ticker snapshots provide an approximate interval volume in REST fallback mode.
- The UI labels this mode `공개 시세 · 약 21초 갱신`.
- Demo mode remains clearly labeled synthetic data and must never be shown as exchange data.

If either batch response omits a market, that market is marked unavailable and cannot produce a simulated order until current price, bid, and ask are all present.

## 5. State Model

### Portfolio state

```text
PortfolioState
- startingCashKrw
- cashKrw
- feeRate
- cumulativeFeesKrw
- realizedPnlKrw
- positionsByMarket
- fills
- running
```

### Position state

```text
Position
- market
- quantityUnits
- averageEntryPriceKrw
- costBasisKrw
- buyFeeKrw
- openedAt
- openedCandleStart
```

Quantities use integer base units per asset to avoid floating-point drift:

- BTC and ETH: 100,000,000 units per coin
- XRP, SOL, and DOGE: 1,000,000 units per coin

The selected precision is an internal simulation precision and does not claim to reproduce every exchange tick-size or quantity rule.

### Market runtime state

```text
MarketRuntime
- market
- displayName
- latestQuote
- currentCandle
- completedCandles
- latestDecision
- latestScore
- lastProcessedCandleStart
- source
- stale
```

### Persistence migration

The existing single-coin localStorage payload is version 1. The multi-coin payload becomes version 2.

On first load after deployment:

- If no position exists, migrate cash, fills, logs, and settings where possible.
- If a legacy BTC position exists, migrate it into `positionsByMarket["KRW-BTC"]`.
- The migrated bot always starts paused.
- If legacy data cannot be safely parsed, preserve it under a backup key and initialize a fresh 50,000 KRW portfolio instead of partially corrupting state.

## 6. Trading Engine Boundaries

Split browser logic into focused modules:

- `markets.mjs`: fixed market metadata and precision
- `scoring.mjs`: score calculations and candidate ranking
- `portfolio.mjs`: shared cash, positions, fees, fills, and constraints
- `feed.mjs`: multi-market WebSocket and batch REST fallback
- `chart.mjs`: selected-market chart rendering
- `app.mjs`: orchestration, persistence, navigation, and rendering

Existing generic candle and moving-average functions stay in `core.mjs` where practical. BTC-specific naming such as `SATS_PER_BTC` must be removed from shared portfolio calculations.

## 7. Safety and Error Handling

- Never submit a simulated order from stale or incomplete market data.
- Never exceed two open positions.
- Never let cash fall below 10,000 KRW after a buy.
- Never create an order below 5,000 KRW.
- Never buy a market already held.
- Never sell more than the full simulated position quantity.
- Process one fill per market per completed candle at most.
- Pause automation after reload, migration, reset, or unrecoverable persistence failure.
- Show which data source is active: WebSocket, public REST fallback, or offline demo.
- Store no API keys, credentials, personal data, or server-side state.

## 8. Test Plan

### Unit tests

- Fee-inclusive 20,000 KRW buy never exceeds the cash cap
- Two buys leave at least 10,000 KRW cash
- Third simultaneous position is rejected
- Sell fee is deducted correctly
- Cumulative and per-market fees are correct
- Minimum 5,000 KRW order is enforced
- Composite score components respect their caps
- Candidate ranking is deterministic on ties
- Sells are processed before buys in the same cycle
- Duplicate fills for one market and candle are blocked
- Quantity precision is preserved through JSON serialization
- Version-1 BTC state migrates to version 2

### Feed tests

- One WebSocket subscription includes all five markets
- WebSocket events are routed by market
- Batch orderbook normalization handles five markets
- Batch ticker normalization handles five markets
- REST fallback alternates requests without exceeding one request per 10 seconds
- Missing or invalid market responses disable only the affected market

### UI checks

- Portfolio and detail navigation works on desktop and mobile
- Market-card selection opens the matching detail tab
- Fee-rate changes immediately update order previews and persist
- Mobile view has no page-level horizontal overflow
- Real, fallback, and synthetic data sources are visibly distinguishable

### Continuous integration

Extend the existing Node test suite and JavaScript syntax checks. Existing Python tests must continue to pass even though the first multi-coin release targets the GitHub Pages browser app.

## 9. Out of Scope

- User-selected arbitrary markets
- More than five fixed assets
- Multiple portfolios or user accounts
- Cloud synchronization between devices
- Real exchange authentication or orders
- Backtesting, optimization, AI prediction, news signals, or social sentiment
- Portfolio rebalancing or partial exits
- Stop-loss and take-profit orders
- Production-grade tax or accounting reports
