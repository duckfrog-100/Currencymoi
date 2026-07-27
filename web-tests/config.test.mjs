import test from "node:test";
import assert from "node:assert/strict";
import { staleLimitForQuote, strategyConfigForMode } from "../docs/config.mjs";

test("public mode leaves stale thresholds to the quotation source", () => {
  const config = strategyConfigForMode("public");
  assert.equal(config.candleSeconds, 60);
  assert.equal(config.fastPeriod, 5);
  assert.equal(config.slowPeriod, 20);
  assert.equal(config.staleAfterMs, undefined);
});

test("offline demo uses five-second candles and an eight-second stale limit", () => {
  const config = strategyConfigForMode("demo");
  assert.deepEqual(config, {
    mode: "demo",
    candleSeconds: 5,
    fastPeriod: 3,
    slowPeriod: 7,
    staleAfterMs: 8_000,
  });
});

test("an explicit threshold cannot make a quotation source less strict", () => {
  assert.equal(staleLimitForQuote({ source: "websocket" }, 35_000), 15_000);
  assert.equal(staleLimitForQuote({ source: "rest" }, 35_000), 35_000);
  assert.equal(staleLimitForQuote({ source: "offline" }, 8_000), 8_000);
});
