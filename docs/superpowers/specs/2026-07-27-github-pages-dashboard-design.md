# Currencymoi GitHub Pages Dashboard Design

## Goal

Publish the 50,000 KRW paper-trading MVP as a free, permanent GitHub Pages site that can be opened without installing Python or running code on a company computer.

## Architecture

- `docs/index.html` and `docs/styles.css` render a responsive dashboard.
- Browser ES modules split responsibilities into market feed, trading core, chart rendering, and UI orchestration.
- The browser connects directly to Upbit's public quotation WebSocket. No API key, private endpoint, server, or real-order capability exists.
- Virtual cash is stored as integer KRW and BTC quantity as satoshis using `BigInt`.
- Portfolio, candles, decisions, and fills persist only in the viewer's `localStorage`.
- When WebSocket access is blocked, the UI exposes an explicitly labeled synthetic offline demo rather than presenting fake prices as real data.

## Trading Rules

- Starting cash: 50,000 KRW
- Buy budget: 40,000 KRW
- Minimum remaining cash: 10,000 KRW
- Normal mode: 60-second candles, SMA 5/20
- Demo mode: 5-second candles, SMA 3/7
- Fee: 0.05 percent
- Slippage: 0.02 percent
- Long-only, one BTC position at a time
- At most one paper fill per completed candle

## Failure Handling

- Reconnect WebSocket no faster than every 10 seconds to respect browser-Origin quotation limits.
- Show a visible blocked-network notice after repeated failures.
- Do not create a paper order without current price and best bid/ask.
- Restore saved results after reload but always restore the bot in paused state.
- Require explicit confirmation before resetting browser history and the 50,000 KRW wallet.

## Testing and Deployment

- Node's built-in test runner verifies configuration, candle rollover, crossover decisions, paper fills, and satoshi serialization.
- GitHub Actions runs Python tests, Python compile checks, browser-module syntax checks, and browser core tests.
- A GitHub Pages workflow publishes the `docs/` directory from `main` to `https://duckfrog-100.github.io/Currencymoi/`.
