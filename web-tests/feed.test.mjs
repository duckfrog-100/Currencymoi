import test from "node:test";
import assert from "node:assert/strict";
import {
  UpbitBrowserFeed,
  buildWebSocketSubscription,
  normalizeRestOrderbooks,
  normalizeRestTickers,
} from "../docs/feed.mjs";
import { marketCodes } from "../docs/markets.mjs";

test("one websocket subscription includes all five markets", () => {
  const codes = marketCodes();
  const subscription = buildWebSocketSubscription(codes, "ticket-1");
  assert.deepEqual(subscription[1], { type: "ticker", codes, is_only_realtime: true });
  assert.deepEqual(subscription[2], { type: "trade", codes, is_only_realtime: true });
  assert.deepEqual(subscription[3], { type: "orderbook", codes, is_only_realtime: true });
});

test("batch orderbooks normalize valid markets by code and skip malformed items", () => {
  const result = normalizeRestOrderbooks([
    { market: "KRW-BTC", timestamp: 1, orderbook_units: [{ bid_price: 99, ask_price: 101 }] },
    { market: "KRW-ETH", timestamp: 2, orderbook_units: [{ bid_price: 49, ask_price: 51 }] },
    { market: "KRW-XRP", timestamp: 3, orderbook_units: [] },
  ]);
  assert.equal(result.size, 2);
  assert.equal(result.get("KRW-BTC").bestBid, 99);
  assert.equal(result.get("KRW-ETH").bestAsk, 51);
});

test("ticker volume delta is tracked independently and never negative", () => {
  const previous = new Map([
    ["KRW-BTC", { accumulatedVolume: 100 }],
    ["KRW-ETH", { accumulatedVolume: 50 }],
  ]);
  const result = normalizeRestTickers([
    { market: "KRW-BTC", timestamp: 2, trade_price: 101, acc_trade_volume_24h: 103 },
    { market: "KRW-ETH", timestamp: 2, trade_price: 51, acc_trade_volume_24h: 49 },
  ], previous);
  assert.equal(result.get("KRW-BTC").volumeDelta, 3);
  assert.equal(result.get("KRW-ETH").volumeDelta, 0);
});

test("websocket items are routed without overwriting another market", () => {
  const snapshots = [];
  const trades = [];
  const feed = new UpbitBrowserFeed({
    markets: ["KRW-BTC", "KRW-ETH"],
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onTrade: (trade) => trades.push(trade),
    onEvent: () => {},
    onStatus: () => {},
    onBlocked: () => {},
  });

  feed.handleItem({ type: "orderbook", code: "KRW-BTC", timestamp: 1, orderbook_units: [{ bid_price: 99, ask_price: 101 }] });
  feed.handleItem({ type: "ticker", code: "KRW-BTC", timestamp: 2, trade_price: 100 });
  feed.handleItem({ type: "orderbook", code: "KRW-ETH", timestamp: 3, orderbook_units: [{ bid_price: 49, ask_price: 51 }] });
  feed.handleItem({ type: "trade", code: "KRW-ETH", trade_timestamp: 4, trade_price: 50, trade_volume: 2 });

  assert.equal(snapshots.at(-2).market, "KRW-BTC");
  assert.equal(snapshots.at(-2).tradePrice, 100);
  assert.equal(snapshots.at(-1).market, "KRW-ETH");
  assert.equal(snapshots.at(-1).bestBid, 49);
  assert.deepEqual(trades.at(-1), { market: "KRW-ETH", timestamp: 4, price: 50, volume: 2, source: "websocket" });
});
