import test from "node:test";
import assert from "node:assert/strict";
import { processDecisionBatch } from "../docs/decision.mjs";
import { SharedPortfolio } from "../docs/portfolio.mjs";

const now = 1_000_000;
const quote = (price) => ({ timestamp: now, tradePrice: price, bestBid: price, bestAsk: price, source: "websocket" });
const buyInput = { bestAsk: 1_000, maxOutflow: 20_000, feeRate: 0.0005, slippageRate: 0, timestamp: 1, candleStart: 0, reason: "seed", score: 1 };

function decision(market, signal, score, candleStart = 60_000) {
  return { market, signal, score: { total: score }, candleStart, timestamp: candleStart + 60_000, reason: `${signal} ${market}` };
}

test("sells are processed before ranked buys in the same batch", () => {
  const portfolio = new SharedPortfolio();
  portfolio.buy({ ...buyInput, market: "KRW-XRP" });
  portfolio.buy({ ...buyInput, market: "KRW-DOGE", timestamp: 2, bestAsk: 500 });
  const quotes = new Map([
    ["KRW-XRP", quote(1_100)],
    ["KRW-DOGE", quote(500)],
    ["KRW-SOL", quote(200_000)],
  ]);
  const result = processDecisionBatch({
    decisions: [decision("KRW-SOL", "BUY", 90), decision("KRW-XRP", "SELL", 10)],
    portfolio,
    quotes,
    feeRate: 0.0005,
    slippageRate: 0,
    now,
  });
  assert.deepEqual(result.fills.map((fill) => [fill.side, fill.market]), [["SELL", "KRW-XRP"], ["BUY", "KRW-SOL"]]);
  assert.equal(portfolio.hasMarket("KRW-SOL"), true);
});

test("highest scores fill two available slots first", () => {
  const portfolio = new SharedPortfolio();
  const quotes = new Map([
    ["KRW-BTC", quote(100_000_000)],
    ["KRW-ETH", quote(5_000_000)],
    ["KRW-SOL", quote(200_000)],
  ]);
  const result = processDecisionBatch({
    decisions: [
      decision("KRW-BTC", "BUY", 70),
      decision("KRW-ETH", "BUY", 90),
      decision("KRW-SOL", "BUY", 80),
    ],
    portfolio,
    quotes,
    feeRate: 0.0005,
    slippageRate: 0,
    now,
  });
  assert.deepEqual(result.fills.map((fill) => fill.market), ["KRW-ETH", "KRW-SOL"]);
});

test("exact score ties use BTC ETH XRP SOL DOGE order", () => {
  const portfolio = new SharedPortfolio();
  const quotes = new Map([
    ["KRW-BTC", quote(100_000_000)],
    ["KRW-SOL", quote(200_000)],
    ["KRW-DOGE", quote(500)],
  ]);
  const result = processDecisionBatch({
    decisions: [
      decision("KRW-DOGE", "BUY", 80),
      decision("KRW-SOL", "BUY", 80),
      decision("KRW-BTC", "BUY", 80),
    ],
    portfolio,
    quotes,
    feeRate: 0.0005,
    slippageRate: 0,
    now,
  });
  assert.deepEqual(result.fills.map((fill) => fill.market), ["KRW-BTC", "KRW-SOL"]);
});

test("duplicate candle decisions and stale quotes cannot trade", () => {
  const portfolio = new SharedPortfolio();
  const processedKeys = new Set(["KRW-BTC:60000"]);
  const quotes = new Map([
    ["KRW-BTC", quote(100_000_000)],
    ["KRW-ETH", { ...quote(5_000_000), timestamp: now - 40_000 }],
  ]);
  const result = processDecisionBatch({
    decisions: [decision("KRW-BTC", "BUY", 90), decision("KRW-ETH", "BUY", 80)],
    portfolio,
    quotes,
    feeRate: 0.0005,
    slippageRate: 0,
    now,
    staleAfterMs: 35_000,
    processedKeys,
  });
  assert.equal(result.fills.length, 0);
  assert.equal(portfolio.positions.size, 0);
  assert.ok(result.skipped.some((item) => item.reason.includes("중복")));
  assert.ok(result.skipped.some((item) => item.reason.includes("오래")));
});
