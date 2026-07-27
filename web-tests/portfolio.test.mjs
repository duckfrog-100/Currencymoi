import test from "node:test";
import assert from "node:assert/strict";
import { SharedPortfolio } from "../docs/portfolio.mjs";

const defaultBuy = {
  bestAsk: 1_000,
  maxOutflow: 20_000,
  feeRate: 0.0005,
  slippageRate: 0,
  timestamp: 1,
  candleStart: 0,
  reason: "test",
  score: 80,
};

test("20,000 won buy cap includes the buy fee", () => {
  const portfolio = new SharedPortfolio();
  const fill = portfolio.buy({ ...defaultBuy, market: "KRW-BTC", bestAsk: 100_000_000 });
  assert.ok(-fill.cashDelta <= 20_000);
  assert.equal(portfolio.cash >= 30_000, true);
  assert.equal(fill.grossAmount + fill.fee, -fill.cashDelta);
});

test("two positions leave at least 10,000 won and a third buy is rejected", () => {
  const portfolio = new SharedPortfolio();
  portfolio.buy({ ...defaultBuy, market: "KRW-XRP" });
  portfolio.buy({ ...defaultBuy, market: "KRW-DOGE", timestamp: 2 });
  assert.equal(portfolio.cash >= 10_000, true);
  assert.equal(portfolio.positions.size, 2);
  assert.throws(() => portfolio.buy({ ...defaultBuy, market: "KRW-SOL", timestamp: 3 }), /최대 2종/);
});

test("orders below 5,000 won and duplicate positions are rejected", () => {
  const portfolio = new SharedPortfolio();
  assert.throws(
    () => portfolio.buy({ ...defaultBuy, market: "KRW-XRP", maxOutflow: 4_999 }),
    /최소 주문금액/,
  );
  portfolio.buy({ ...defaultBuy, market: "KRW-XRP" });
  assert.throws(() => portfolio.buy({ ...defaultBuy, market: "KRW-XRP", timestamp: 2 }), /이미 보유/);
});

test("sell fee is deducted and cumulative fees include both sides", () => {
  const portfolio = new SharedPortfolio();
  const buy = portfolio.buy({ ...defaultBuy, market: "KRW-XRP" });
  const sell = portfolio.sell({
    market: "KRW-XRP",
    bestBid: 1_100,
    feeRate: 0.0005,
    slippageRate: 0,
    timestamp: 2,
    candleStart: 60_000,
    reason: "test",
    score: 20,
  });
  assert.equal(portfolio.positions.size, 0);
  assert.equal(portfolio.cumulativeFees, buy.fee + sell.fee);
  assert.equal(sell.cashDelta, sell.grossAmount - sell.fee);
  assert.equal(portfolio.realizedPnl, sell.realizedPnl);
});

test("portfolio JSON round-trip preserves quantities, fees, and realized PnL", () => {
  const portfolio = new SharedPortfolio();
  portfolio.buy({ ...defaultBuy, market: "KRW-BTC", bestAsk: 100_000_000 });
  portfolio.buy({ ...defaultBuy, market: "KRW-XRP", timestamp: 2 });
  portfolio.sell({
    market: "KRW-XRP",
    bestBid: 1_100,
    feeRate: 0.0005,
    slippageRate: 0,
    timestamp: 3,
    candleStart: 60_000,
    reason: "test",
    score: 20,
  });
  const restored = SharedPortfolio.fromJSON(JSON.parse(JSON.stringify(portfolio.toJSON())));
  assert.equal(restored.positions.get("KRW-BTC").quantityUnits, portfolio.positions.get("KRW-BTC").quantityUnits);
  assert.equal(restored.cumulativeFees, portfolio.cumulativeFees);
  assert.equal(restored.realizedPnl, portfolio.realizedPnl);
  assert.equal(restored.cash, portfolio.cash);
});

test("snapshot values every held market against its current quote", () => {
  const portfolio = new SharedPortfolio();
  portfolio.buy({ ...defaultBuy, market: "KRW-XRP" });
  portfolio.buy({ ...defaultBuy, market: "KRW-DOGE", timestamp: 2, bestAsk: 500 });
  const snapshot = portfolio.snapshot(new Map([
    ["KRW-XRP", { tradePrice: 1_100 }],
    ["KRW-DOGE", { tradePrice: 550 }],
  ]));
  assert.equal(snapshot.positionCount, 2);
  assert.equal(snapshot.totalEquity, snapshot.cash + snapshot.positions.reduce((sum, position) => sum + position.marketValue, 0));
  assert.ok(snapshot.totalEquity > 50_000);
});
