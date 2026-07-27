import test from "node:test";
import assert from "node:assert/strict";
import { MARKETS, marketCodes } from "../docs/markets.mjs";
import { rankCandidates, scoreCandidate } from "../docs/scoring.mjs";

test("fixed markets are BTC ETH XRP SOL DOGE in tie-break order", () => {
  assert.deepEqual(marketCodes(), ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"]);
  assert.deepEqual(MARKETS.map((market) => market.symbol), ["BTC", "ETH", "XRP", "SOL", "DOGE"]);
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

test("composite score clamps negative inputs to zero", () => {
  const candles = [
    { close: 103, volume: 10 },
    { close: 102, volume: 10 },
    { close: 101, volume: 10 },
    { close: 100, volume: 10 },
    { close: 99, volume: 10 },
    { close: 98, volume: 5 },
  ];
  assert.deepEqual(scoreCandidate({ candles, fastSma: 99, slowSma: 100 }), {
    total: 0,
    movingAverage: 0,
    momentum: 0,
    volume: 0,
  });
});

test("candidate ties use BTC ETH XRP SOL DOGE order", () => {
  const ranked = rankCandidates([
    { market: "KRW-DOGE", score: 50 },
    { market: "KRW-BTC", score: 50 },
    { market: "KRW-SOL", score: 50 },
  ]);
  assert.deepEqual(ranked.map((item) => item.market), ["KRW-BTC", "KRW-SOL", "KRW-DOGE"]);
});
