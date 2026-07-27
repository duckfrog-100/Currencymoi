import test from "node:test";
import assert from "node:assert/strict";
import {
  CandleBuilder,
  MovingAverageCrossover,
  PaperBroker,
  Portfolio,
  Signal,
  configForMode,
} from "../docs/core.mjs";
import { normalizeRestOrderbook } from "../docs/feed.mjs";

test("normal and demo modes keep the 50,000 won wallet", () => {
  const normal = configForMode("normal");
  const demo = configForMode("demo");
  assert.equal(normal.startingCash, 50_000);
  assert.equal(normal.buyBudget, 40_000);
  assert.deepEqual([normal.candleSeconds, normal.fastPeriod, normal.slowPeriod], [60, 5, 20]);
  assert.deepEqual([demo.candleSeconds, demo.fastPeriod, demo.slowPeriod], [5, 3, 7]);
});

test("candle builder returns the completed OHLC candle on rollover", () => {
  const builder = new CandleBuilder(60);
  assert.equal(builder.addTrade(1_000, 100, 1), null);
  assert.equal(builder.addTrade(30_000, 110, 2), null);
  const candle = builder.addTrade(60_000, 105, 1);
  assert.deepEqual(
    [candle.open, candle.high, candle.low, candle.close, candle.volume],
    [100, 110, 100, 110, 3],
  );
});

function candles(values) {
  return values.map((close, index) => ({
    startTime: index * 5_000,
    intervalSeconds: 5,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

test("moving averages emit buy and sell only on a crossover", () => {
  const strategy = new MovingAverageCrossover(3, 5);
  const buy = strategy.evaluate(candles([10, 10, 10, 10, 10, 9, 12]), false);
  assert.equal(buy.signal, Signal.BUY);
  const sell = strategy.evaluate(candles([10, 10, 10, 10, 10, 11, 8]), true);
  assert.equal(sell.signal, Signal.SELL);
});

test("paper buy keeps 10,000 won cash and a later sell closes the position", () => {
  const broker = new PaperBroker(0.0005, 0.0002);
  const portfolio = new Portfolio();
  const buy = broker.buy({
    budget: 40_000,
    bestAsk: 100_000_000,
    timestamp: 1,
    reason: "test",
    candleStart: 0,
  });
  portfolio.applyFill(buy);
  assert.equal(portfolio.cash, 10_000);
  assert.ok(portfolio.btcSats > 0n);
  const sell = broker.sell({
    quantitySats: portfolio.btcSats,
    bestBid: 101_000_000,
    timestamp: 2,
    reason: "test",
    candleStart: 5_000,
  });
  portfolio.applyFill(sell);
  assert.equal(portfolio.btcSats, 0n);
  assert.ok(portfolio.cash > 10_000);
});

test("portfolio JSON round-trip preserves satoshis", () => {
  const portfolio = new Portfolio({ cash: 10_000, btcSats: 39_972n, averageEntryPrice: 100_070_000 });
  const restored = Portfolio.fromJSON(JSON.parse(JSON.stringify(portfolio.toJSON())));
  assert.equal(restored.btcSats, 39_972n);
  assert.equal(restored.cash, 10_000);
});

test("REST orderbook response becomes a real public market snapshot", () => {
  const snapshot = normalizeRestOrderbook([
    {
      timestamp: 1_785_110_400_000,
      orderbook_units: [{ bid_price: 99_999_000, ask_price: 100_001_000 }],
    },
  ]);
  assert.deepEqual(snapshot, {
    timestamp: 1_785_110_400_000,
    tradePrice: 100_000_000,
    bestBid: 99_999_000,
    bestAsk: 100_001_000,
    source: "rest",
  });
});

test("REST fallback rejects malformed or crossed orderbooks", () => {
  assert.throws(() => normalizeRestOrderbook([]), /유효한 최우선 호가/);
  assert.throws(
    () => normalizeRestOrderbook([{ orderbook_units: [{ bid_price: 101, ask_price: 100 }] }]),
    /유효한 최우선 호가/,
  );
});
