# Multi-Coin Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-market KRW-BTC GitHub Pages app with a five-market shared-wallet paper-trading portfolio for BTC, ETH, XRP, SOL, and DOGE.

**Architecture:** Keep generic candle and SMA logic in `docs/core.mjs`, then add focused modules for market metadata, composite scoring, and the shared portfolio. Upgrade `docs/feed.mjs` to route one five-market WebSocket subscription and a rate-limited batch REST fallback. Rebuild `docs/app.mjs` as the orchestration layer for state migration, aligned decision cycles, navigation, and rendering.

**Tech Stack:** Static HTML/CSS, browser ES modules, Canvas 2D, localStorage, Upbit public quotation WebSocket and REST endpoints, Node.js built-in test runner, GitHub Actions, GitHub Pages.

## Global Constraints

- Fixed markets: `KRW-BTC`, `KRW-ETH`, `KRW-XRP`, `KRW-SOL`, `KRW-DOGE`.
- Shared starting cash: 50,000 KRW.
- Maximum simultaneous positions: 2.
- Maximum buy cash outflow per position: 20,000 KRW including buy fee.
- Minimum cash after a buy: 10,000 KRW.
- Minimum simulated order value: 5,000 KRW.
- Default fee: 0.05 percent; editable from 0.00 to 1.00 percent in 0.01 percentage-point steps.
- Default slippage: 0.02 percent.
- Public mode: 60-second candles, SMA 5/20.
- Offline demo: 5-second candles, SMA 3/7, isolated localStorage namespace.
- No API keys, authenticated endpoints, real orders, deposits, withdrawals, leverage, derivatives, or investment-advice claims.

---

### Task 1: Market metadata and composite scoring

**Files:**
- Create: `docs/markets.mjs`
- Create: `docs/scoring.mjs`
- Create: `web-tests/scoring.test.mjs`

**Interfaces:**
- Produces: `MARKETS`, `MARKET_BY_CODE`, `marketCodes()`, `scoreCandidate({ candles, fastSma, slowSma })`, `rankCandidates(candidates)`.
- `scoreCandidate` returns `{ total, movingAverage, momentum, volume }` with numeric values.

- [ ] **Step 1: Write failing tests for fixed market metadata and deterministic ranking**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { MARKETS, marketCodes } from "../docs/markets.mjs";
import { rankCandidates, scoreCandidate } from "../docs/scoring.mjs";

test("fixed markets are BTC ETH XRP SOL DOGE in tie-break order", () => {
  assert.deepEqual(marketCodes(), ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"]);
  assert.equal(MARKETS[0].symbol, "BTC");
});

test("composite score respects 50 30 20 caps", () => {
  const candles = [
    { close: 100, volume: 10 },
    { close: 100, volume: 10 },
    { close: 100, volume: 10 },
    { close: 100, volume: 10 },
    { close: 100, volume: 10 },
    { close: 103, volume: 30 },
  ];
  assert.deepEqual(scoreCandidate({ candles, fastSma: 101, slowSma: 100 }), {
    total: 100,
    movingAverage: 50,
    momentum: 30,
    volume: 20,
  });
});

test("candidate ties use BTC ETH XRP SOL DOGE order", () => {
  const ranked = rankCandidates([
    { market: "KRW-DOGE", score: 50 },
    { market: "KRW-BTC", score: 50 },
  ]);
  assert.deepEqual(ranked.map((item) => item.market), ["KRW-BTC", "KRW-DOGE"]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test web-tests/scoring.test.mjs`

Expected: FAIL because `docs/markets.mjs` and `docs/scoring.mjs` do not exist.

- [ ] **Step 3: Implement fixed metadata and capped score formulas**

`docs/markets.mjs` must export five immutable records containing `market`, `symbol`, `koreanName`, `unitsPerCoin`, and `tieBreakIndex`.

`docs/scoring.mjs` must:
- calculate moving-average score from a 0 to 1 percent spread into 0 to 50 points;
- calculate three-candle momentum from 0 to 3 percent into 0 to 30 points;
- calculate latest-volume ratio versus previous-five average from 1.0 to 3.0 into 0 to 20 points;
- clamp each component;
- keep unrounded values for sorting and expose values rounded to two decimals;
- sort descending by score, then ascending by `tieBreakIndex`.

- [ ] **Step 4: Run scoring tests and the existing suite**

Run:

```bash
node --test web-tests/scoring.test.mjs
node --test web-tests/core.test.mjs web-tests/scoring.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/markets.mjs docs/scoring.mjs web-tests/scoring.test.mjs
git commit -m "feat: add multi-coin market scoring"
```

### Task 2: Shared portfolio, fees, constraints, and serialization

**Files:**
- Create: `docs/portfolio.mjs`
- Create: `web-tests/portfolio.test.mjs`
- Modify: `docs/core.mjs`

**Interfaces:**
- Consumes: `MARKET_BY_CODE`.
- Produces: `SharedPortfolio.fromJSON(payload)`, `portfolio.previewBuy({ market, bestAsk, maxOutflow, feeRate, slippageRate })`, `portfolio.buy(...)`, `portfolio.sell(...)`, `portfolio.snapshot(quotesByMarket)`, `portfolio.toJSON()`.
- Fill shape: `{ market, side, timestamp, candleStart, executionPrice, quantityUnits, grossAmount, fee, cashDelta, realizedPnl, reason, score }`.

- [ ] **Step 1: Write failing tests for fee-inclusive buys and the two-position cap**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { SharedPortfolio } from "../docs/portfolio.mjs";

test("20,000 won buy cap includes the buy fee", () => {
  const portfolio = new SharedPortfolio();
  const fill = portfolio.buy({
    market: "KRW-BTC",
    bestAsk: 100_000_000,
    maxOutflow: 20_000,
    feeRate: 0.0005,
    slippageRate: 0.0002,
    timestamp: 1,
    candleStart: 0,
    reason: "test",
    score: 80,
  });
  assert.ok(-fill.cashDelta <= 20_000);
  assert.equal(portfolio.cash >= 30_000, true);
});

test("two positions leave at least 10,000 won and a third buy is rejected", () => {
  const portfolio = new SharedPortfolio();
  const input = { bestAsk: 1000, maxOutflow: 20_000, feeRate: 0.0005, slippageRate: 0, timestamp: 1, candleStart: 0, reason: "test", score: 80 };
  portfolio.buy({ ...input, market: "KRW-XRP" });
  portfolio.buy({ ...input, market: "KRW-DOGE", timestamp: 2 });
  assert.equal(portfolio.cash >= 10_000, true);
  assert.throws(() => portfolio.buy({ ...input, market: "KRW-SOL", timestamp: 3 }), /최대 2종/);
});

test("sell fee is deducted and cumulative fees include both sides", () => {
  const portfolio = new SharedPortfolio();
  const buy = portfolio.buy({ market: "KRW-XRP", bestAsk: 1000, maxOutflow: 20_000, feeRate: 0.0005, slippageRate: 0, timestamp: 1, candleStart: 0, reason: "test", score: 80 });
  const sell = portfolio.sell({ market: "KRW-XRP", bestBid: 1100, feeRate: 0.0005, slippageRate: 0, timestamp: 2, candleStart: 60_000, reason: "test", score: 20 });
  assert.equal(portfolio.positions.size, 0);
  assert.equal(portfolio.cumulativeFees, buy.fee + sell.fee);
  assert.ok(sell.cashDelta < sell.grossAmount);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test web-tests/portfolio.test.mjs`

Expected: FAIL because `SharedPortfolio` does not exist.

- [ ] **Step 3: Implement the shared portfolio minimally**

Implementation rules:
- store quantity as integer asset base units from market metadata;
- `assetSpend = floor(maxOutflow / (1 + feeRate))`;
- `fee = floor(assetSpend * feeRate)`;
- use best ask increased by slippage for buys and best bid decreased by slippage for sells;
- reject duplicate positions, orders below 5,000 KRW, more than two positions, and buys that leave less than 10,000 KRW;
- close the entire position on sell;
- include buy fee in cost basis for PnL;
- serialize integer units as strings and restore them exactly;
- remove BTC-only assumptions from shared calculations in `core.mjs` while preserving `CandleBuilder`, SMA, and crossover behavior.

- [ ] **Step 4: Add serialization and snapshot tests**

Add tests proving:
- XRP and BTC quantities survive JSON round trips;
- total equity equals cash plus all marked position values;
- cumulative fees and realized PnL survive reload.

- [ ] **Step 5: Run all browser core tests**

Run:

```bash
node --test web-tests/core.test.mjs web-tests/scoring.test.mjs web-tests/portfolio.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/core.mjs docs/portfolio.mjs web-tests/portfolio.test.mjs
git commit -m "feat: add shared multi-coin portfolio"
```

### Task 3: Multi-market quotation feed

**Files:**
- Modify: `docs/feed.mjs`
- Create: `web-tests/feed.test.mjs`

**Interfaces:**
- Consumes: `marketCodes()`.
- Produces: `normalizeRestOrderbooks(payload)`, `normalizeRestTickers(payload, previousByMarket)`, and `UpbitBrowserFeed` callbacks carrying `market` on every snapshot and trade.

- [ ] **Step 1: Write failing batch-normalization tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRestOrderbooks, normalizeRestTickers } from "../docs/feed.mjs";

test("batch orderbooks normalize all valid markets by code", () => {
  const result = normalizeRestOrderbooks([
    { market: "KRW-BTC", timestamp: 1, orderbook_units: [{ bid_price: 99, ask_price: 101 }] },
    { market: "KRW-ETH", timestamp: 2, orderbook_units: [{ bid_price: 49, ask_price: 51 }] },
  ]);
  assert.equal(result.get("KRW-BTC").bestBid, 99);
  assert.equal(result.get("KRW-ETH").bestAsk, 51);
});

test("ticker volume delta is non-negative per market", () => {
  const previous = new Map([["KRW-BTC", { accumulatedVolume: 100 }]]);
  const result = normalizeRestTickers([{ market: "KRW-BTC", timestamp: 2, trade_price: 101, acc_trade_volume_24h: 103 }], previous);
  assert.equal(result.get("KRW-BTC").volumeDelta, 3);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test web-tests/feed.test.mjs`

Expected: FAIL because batch functions are missing.

- [ ] **Step 3: Upgrade the WebSocket subscription**

Use one connection and send one subscription containing all five market codes for ticker, trade, and one-level orderbook. Every callback payload must include `market`. Route binary and Blob responses through the same parser. A valid event for one market must not overwrite another market's quote.

- [ ] **Step 4: Implement alternating batch REST fallback**

Requirements:
- after two WebSocket failures, stop WebSocket retries;
- wait 10.5 seconds, then alternate one request every 10.5 seconds between `/v1/orderbook?markets=<all-five>` and `/v1/ticker?markets=<all-five>`;
- cache orderbook and ticker pieces per market;
- emit a usable quote only when current price, best bid, and best ask are available and fresh;
- label callback source as `rest`;
- isolate malformed or missing markets instead of failing the entire batch;
- stop timers and abort in-flight requests on disconnect.

- [ ] **Step 5: Run feed tests and JavaScript syntax checks**

Run:

```bash
node --test web-tests/feed.test.mjs
node --check docs/feed.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/feed.mjs web-tests/feed.test.mjs
git commit -m "feat: add five-market quotation feed"
```

### Task 4: Portfolio orchestration, decision cycles, and state migration

**Files:**
- Modify: `docs/app.mjs`
- Create: `docs/state.mjs`
- Create: `web-tests/state.test.mjs`
- Create: `web-tests/decision-cycle.test.mjs`

**Interfaces:**
- Produces: `loadModeState(mode, storage)`, `saveModeState(mode, state, storage)`, `migrateLegacyState(payload)`, `processDecisionBatch({ decisions, portfolio, quotes, feeRate, slippageRate })`.

- [ ] **Step 1: Write failing migration tests**

Test that version-1 cash and BTC holdings become version-2 `positionsByMarket["KRW-BTC"]`, the bot resumes paused, and invalid legacy JSON is backed up before a fresh state is created.

- [ ] **Step 2: Write failing decision-batch tests**

Cover:
- bearish sells execute before bullish buys;
- highest composite scores fill available slots first;
- exact ties use BTC, ETH, XRP, SOL, DOGE order;
- duplicate market/candle fills are ignored;
- stale or incomplete quotes cannot trade.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
node --test web-tests/state.test.mjs web-tests/decision-cycle.test.mjs
```

Expected: FAIL because state and batch functions are missing.

- [ ] **Step 4: Implement separate public and demo state namespaces**

Use:
- `currencymoi.portfolio.public.v2`
- `currencymoi.portfolio.demo.v2`
- `currencymoi.github-pages.v1.backup`

Mode changes must pause automation before saving and loading the other namespace.

- [ ] **Step 5: Rebuild app orchestration around per-market runtime objects**

Each runtime contains market metadata, quote, candle builder, completed candles, strategy, score, latest decision, source, and last processed candle. Collect completed-candle decisions into aligned buckets and process a bucket after a two-second grace period. Render once after each feed event and decision batch, plus a low-frequency clock refresh for staleness labels.

- [ ] **Step 6: Run state, decision, scoring, and portfolio tests**

Run:

```bash
node --test web-tests/state.test.mjs web-tests/decision-cycle.test.mjs web-tests/scoring.test.mjs web-tests/portfolio.test.mjs
node --check docs/app.mjs docs/state.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/app.mjs docs/state.mjs web-tests/state.test.mjs web-tests/decision-cycle.test.mjs
git commit -m "feat: orchestrate multi-coin trading cycles"
```

### Task 5: Two-view responsive portfolio interface

**Files:**
- Modify: `docs/index.html`
- Modify: `docs/styles.css`
- Modify: `docs/chart.mjs`
- Modify: `docs/app.mjs`

**Interfaces:**
- `drawPriceChart(canvas, candles, fills, strategyConfig)` renders only the selected market.
- DOM data IDs must include portfolio summary, five market cards, position cards, ranked decisions, detail tabs, score components, order preview, fills, and logs.

- [ ] **Step 1: Add a static DOM contract test before modifying markup**

Create `web-tests/dom-contract.test.mjs` that reads `docs/index.html` and asserts required data IDs and all five market tab values exist.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test web-tests/dom-contract.test.mjs`

Expected: FAIL because the portfolio/detail DOM is absent.

- [ ] **Step 3: Replace the single-market layout with the approved wireframe structure**

Required sections:
- portfolio/detail navigation;
- total equity, cash, position count, cumulative fees;
- execution controls and editable fee input;
- five market cards;
- current positions;
- ranked decisions;
- combined fills;
- selected-market detail metrics, chart, score breakdown, order preview, market-specific fills and decisions;
- explicit data-source notice and offline-demo distinction.

- [ ] **Step 4: Implement mobile layouts**

Below 680 CSS pixels:
- no page-level horizontal overflow;
- summary cards become two columns or one column when necessary;
- five market cards may use a local horizontal scroller;
- tables become stacked cards;
- buttons and inputs remain at least normal mobile tap size.

- [ ] **Step 5: Connect rendering and navigation**

Market-card selection opens the matching detail market. Detail tabs change the selected market without resetting strategy state. Fee changes validate 0.00 to 1.00 percent, persist immediately, and update order previews without creating a fill.

- [ ] **Step 6: Run DOM, syntax, and all Node tests**

Run:

```bash
node --test web-tests/*.test.mjs
node --check docs/core.mjs docs/markets.mjs docs/scoring.mjs docs/portfolio.mjs docs/feed.mjs docs/state.mjs docs/chart.mjs docs/app.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/index.html docs/styles.css docs/chart.mjs docs/app.mjs web-tests/dom-contract.test.mjs
git commit -m "feat: add multi-coin portfolio interface"
```

### Task 6: Documentation, continuous integration, and deployment verification

**Files:**
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- CI runs all browser tests through `node --test web-tests/*.test.mjs` and syntax-checks every browser module.

- [ ] **Step 1: Update CI commands**

Replace the single test-file command with all `web-tests/*.test.mjs`. Add syntax checks for `markets.mjs`, `scoring.mjs`, `portfolio.mjs`, and `state.mjs`.

- [ ] **Step 2: Update the README**

Document the five fixed markets, shared wallet, maximum two positions, fee behavior, composite score, public REST fallback, public/demo state separation, and paper-trading-only safety boundary.

- [ ] **Step 3: Run full verification locally or through GitHub Actions**

Run:

```bash
python -m pytest -q
python -m compileall -q currencymoi app.py
node --test web-tests/*.test.mjs
node --check docs/core.mjs docs/markets.mjs docs/scoring.mjs docs/portfolio.mjs docs/feed.mjs docs/state.mjs docs/chart.mjs docs/app.mjs
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md .github/workflows/ci.yml
git commit -m "docs: describe multi-coin portfolio"
```

- [ ] **Step 5: Open a pull request and require successful CI before merge**

PR title: `feat: add shared multi-coin paper trading portfolio`

PR body must summarize product rules, data-source behavior, test coverage, mobile behavior, and safety boundaries.

- [ ] **Step 6: Merge and verify Pages deployment**

After CI success, merge to `main`, wait for `Deploy GitHub Pages`, and confirm the published page contains the five symbols `BTC`, `ETH`, `XRP`, `SOL`, and `DOGE` and displays the shared 50,000 KRW wallet.
