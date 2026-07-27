import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapMarketsSequentially,
  buildDemoWarmupCandles,
  normalizeMinuteCandles,
} from "../docs/history.mjs";

function minutePayload({ now, count }) {
  const latestMinute = Math.floor(now / 60_000) * 60_000;
  return Array.from({ length: count }, (_, index) => {
    const startTime = latestMinute - index * 60_000;
    const close = 100 + (count - index);
    return {
      candle_date_time_utc: new Date(startTime).toISOString().replace(".000Z", ""),
      opening_price: close - 1,
      high_price: close + 2,
      low_price: close - 2,
      trade_price: close,
      candle_acc_trade_volume: 10 + index,
    };
  });
}

test("minute history becomes 21 completed ascending candles", () => {
  const now = Date.UTC(2026, 6, 27, 6, 30, 30);
  const candles = normalizeMinuteCandles(minutePayload({ now, count: 23 }), { now, limit: 21 });

  assert.equal(candles.length, 21);
  assert.ok(candles.every((candle) => candle.startTime + 60_000 <= now));
  assert.ok(candles.every((candle, index) => index === 0 || candles[index - 1].startTime < candle.startTime));
  assert.equal(candles.at(-1).startTime, Date.UTC(2026, 6, 27, 6, 29, 0));
});

test("five markets bootstrap sequentially and report visible progress", async () => {
  const calls = [];
  const waits = [];
  const progress = [];
  const markets = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];

  await bootstrapMarketsSequentially(markets, {
    intervalMs: 10_500,
    fetchMarket: async (market) => {
      calls.push(market);
      return [{ market }];
    },
    wait: async (milliseconds) => waits.push(milliseconds),
    onProgress: ({ loaded, total, market, candles }) => progress.push({ loaded, total, market, candles }),
  });

  assert.deepEqual(calls, markets);
  assert.deepEqual(waits, [10_500, 10_500, 10_500, 10_500, 10_500]);
  assert.deepEqual(progress.map(({ loaded, total, market }) => [loaded, total, market]), [
    [1, 5, "KRW-BTC"],
    [2, 5, "KRW-ETH"],
    [3, 5, "KRW-XRP"],
    [4, 5, "KRW-SOL"],
    [5, 5, "KRW-DOGE"],
  ]);
});

test("offline demo receives enough completed candles for SMA 3/7 immediately", () => {
  const now = Date.UTC(2026, 6, 27, 6, 30, 30);
  const candles = buildDemoWarmupCandles({ now, basePrice: 100_000, count: 8, intervalSeconds: 5, phase: 2 });

  assert.equal(candles.length, 8);
  assert.ok(candles.every((candle) => candle.startTime + 5_000 <= now));
  assert.ok(candles.some((candle, index) => index > 0 && candle.close !== candles[index - 1].close));
});
