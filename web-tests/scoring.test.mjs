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
  const score = scoreCandidate({ candles, fastSma: 101, slowSma: 100 });
  assert.equal(score.total, 100);
  assert.equal(score.movingAverage, 50);
  assert.equal(score.momentum, 30);
  assert.equal(score.volume, 20);
  assert.equal(score.rankingValue, 100);
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
  const score = scoreCandidate({ candles, fastSma: 99, slowSma: 100 });
  assert.equal(score.total, 0);
  assert.equal(score.movingAverage, 0);
  assert.equal(score.momentum, 0);
  assert.equal(score.volume, 0);
  assert.equal(score.rankingValue, 0);
});

test("unrounded ranking value wins before the visible rounded score tie", () => {
  const ranked = rankCandidates([
    { market: "KRW-BTC", score: { total: 50, rankingValue: 50.001 } },
    { market: "KRW-ETH", score: { total: 50, rankingValue: 50.009 } },
  ]);
  assert.deepEqual(ranked.map((item) => item.market), ["KRW-ETH", "KRW-BTC"]);
});

test("true score ties use BTC ETH XRP SOL DOGE order", () => {
  const ranked = rankCandidates([
    { market: "KRW-DOGE", score: 50 },
    { market: "KRW-BTC", score: 50 },
    { market: "KRW-SOL", score: 50 },
  ]);
  assert.deepEqual(ranked.map((item) => item.market), ["KRW-BTC", "KRW-SOL", "KRW-DOGE"]);
});
