import test from "node:test";
import assert from "node:assert/strict";
import { createFreshState } from "../docs/state.mjs";
import { setBootstrapControls } from "../docs/startup.mjs";
import { applyMarketWarmup, historyNeedsRefresh } from "../docs/warmup-state.mjs";

function risingCandles(count = 21) {
  return Array.from({ length: count }, (_, index) => {
    const close = index < 16 ? 100 : 100 + (index - 15) * 2;
    return {
      startTime: index * 60_000,
      intervalSeconds: 60,
      open: close,
      high: close,
      low: close,
      close,
      volume: index < 20 ? 10 : 30,
    };
  });
}

test("historical candles create a visible score and decision in saved state", () => {
  const state = createFreshState("public");
  const next = applyMarketWarmup(state, "KRW-BTC", risingCandles(), { hasPosition: false });
  const marketState = next.markets["KRW-BTC"];

  assert.equal(marketState.candles.length, 21);
  assert.equal(marketState.decisions.length, 1);
  assert.equal(marketState.decisions[0].market, "KRW-BTC");
  assert.ok(marketState.decisions[0].score.total > 0);
  assert.match(marketState.decisions[0].reason, /과거 1분봉/);
});

test("fresh 21-candle history is reused but stale history refreshes", () => {
  const now = 2_000_000;
  const fresh = risingCandles().map((candle, index, list) => ({
    ...candle,
    startTime: now - (list.length - index) * 60_000,
  }));
  assert.equal(historyNeedsRefresh(fresh, { now, maximumAgeMs: 10 * 60_000 }), false);
  assert.equal(historyNeedsRefresh(fresh.map((candle) => ({ ...candle, startTime: candle.startTime - 60 * 60_000 })), { now, maximumAgeMs: 10 * 60_000 }), true);
  assert.equal(historyNeedsRefresh(fresh.slice(0, 20), { now }), true);
});

test("start and reset controls are visibly disabled while scores prepare", () => {
  const controls = {
    startButton: { disabled: false, textContent: "▶ 시작" },
    pauseButton: { disabled: false },
    resetButton: { disabled: false },
    feeInput: { disabled: false },
  };

  setBootstrapControls(controls, true);
  assert.equal(controls.startButton.disabled, true);
  assert.equal(controls.startButton.textContent, "점수 준비 중");
  assert.equal(controls.pauseButton.disabled, true);
  assert.equal(controls.resetButton.disabled, true);
  assert.equal(controls.feeInput.disabled, true);

  setBootstrapControls(controls, false);
  assert.equal(controls.startButton.disabled, false);
  assert.equal(controls.startButton.textContent, "▶ 시작");
  assert.equal(controls.pauseButton.disabled, false);
  assert.equal(controls.resetButton.disabled, false);
  assert.equal(controls.feeInput.disabled, false);
});
