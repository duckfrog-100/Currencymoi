import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");

const requiredIds = [
  "portfolioTab",
  "detailTab",
  "portfolioView",
  "detailView",
  "startButton",
  "pauseButton",
  "resetButton",
  "modeSelect",
  "feeInput",
  "bootstrapStatus",
  "botStatus",
  "connectionStatus",
  "modeStatus",
  "totalEquity",
  "totalPnl",
  "cash",
  "positionCount",
  "cumulativeFees",
  "marketCards",
  "positionCards",
  "rankedDecisions",
  "combinedFills",
  "selectedSymbol",
  "selectedKoreanName",
  "detailPrice",
  "detailBestBid",
  "detailBestAsk",
  "detailPosition",
  "detailScore",
  "detailSignal",
  "scoreMa",
  "scoreMomentum",
  "scoreVolume",
  "orderPreview",
  "chart",
  "detailFills",
  "detailDecisions",
  "logs",
];

test("portfolio and detail views expose the required DOM contract", () => {
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`data-id=["']${id}["']`), `missing data-id=${id}`);
  }
});

test("detail navigation contains all five fixed markets", () => {
  for (const market of ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"]) {
    assert.match(html, new RegExp(`data-market=["']${market}["']`), `missing ${market}`);
  }
});

test("page loads the warmup entrypoint before the dashboard app", () => {
  assert.match(html, /src=["']\.\/main\.mjs["']/);
  assert.doesNotMatch(html, /src=["']\.\/app\.mjs["']/);
});
