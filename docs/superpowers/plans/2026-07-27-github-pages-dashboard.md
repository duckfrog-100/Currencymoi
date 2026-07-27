# GitHub Pages Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Currencymoi as a browser-only GitHub Pages paper-trading dashboard while preserving the 50,000 KRW strategy and excluding all real-order capability.

**Architecture:** The static site is served from `docs/`. Pure trading logic is isolated from browser networking and rendering, the Upbit public WebSocket adapter emits normalized market events, the UI persists virtual state in localStorage, and GitHub Actions verifies both Python and JavaScript implementations before Pages deployment.

**Tech Stack:** HTML5, CSS, browser ES modules, Canvas 2D, WebSocket, localStorage, Node.js 20 test runner, GitHub Actions, GitHub Pages

## Global Constraints

- No API key, JWT, private Upbit endpoint, real order, deposit, withdrawal, leverage, or custody feature.
- Starting cash is exactly 50,000 KRW and default buy budget is exactly 40,000 KRW.
- Browser wallet calculations store cash as integer KRW and BTC as satoshis using BigInt.
- Normal mode uses 60-second candles with SMA 5/20; demo mode uses 5-second candles with SMA 3/7.
- A repeated WebSocket failure must never be hidden; synthetic prices must be labeled offline demo.
- Reloading the page restores history but pauses automated paper execution.

---

### Task 1: Browser Trading Core

**Files:**
- Create: `docs/core.mjs`
- Create: `web-tests/core.test.mjs`

- [x] Add failing tests for configuration, candle rollover, crossover decisions, paper fills, and satoshi persistence.
- [x] Implement isolated core classes and functions.
- [x] Run `node --test web-tests/core.test.mjs` and verify all tests pass.

### Task 2: Public Market Feed

**Files:**
- Create: `docs/feed.mjs`

- [x] Connect only to `wss://api.upbit.com/websocket/v1`.
- [x] Subscribe to ticker, trade, and orderbook for `KRW-BTC`.
- [x] Normalize price, volume, best bid, best ask, and timestamp.
- [x] Reconnect at a 10-second minimum and surface repeated network failures.

### Task 3: Dashboard and Persistence

**Files:**
- Create: `docs/index.html`
- Create: `docs/styles.css`
- Create: `docs/chart.mjs`
- Create: `docs/app.mjs`

- [x] Render connection, strategy, market, portfolio, decision, trade, chart, and log sections.
- [x] Add start, pause, mode, reset, and offline-demo controls.
- [x] Persist portfolio and history to localStorage with paused restore behavior.
- [x] Draw price, SMA lines, and buy/sell markers using Canvas.

### Task 4: Continuous Verification

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] Run all Python tests and compile checks.
- [x] Run browser JavaScript syntax checks.
- [x] Run Node browser-core tests.

### Task 5: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`

- [x] Upload only the `docs/` directory as the Pages artifact.
- [x] Deploy only from `main` with Pages and OIDC permissions.
- [x] Document the expected public URL and one-time repository Pages setting.
