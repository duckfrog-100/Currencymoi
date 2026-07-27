import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_BACKUP_KEY,
  LEGACY_STORAGE_KEY,
  createFreshState,
  loadModeState,
  migrateLegacyState,
  saveModeState,
  storageKeyForMode,
} from "../docs/state.mjs";

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test("public and demo modes use independent version-two storage keys", () => {
  assert.notEqual(storageKeyForMode("public"), storageKeyForMode("demo"));
  const storage = new MemoryStorage();
  saveModeState("public", { ...createFreshState("public"), feeRate: 0.0007 }, storage);
  saveModeState("demo", { ...createFreshState("demo"), feeRate: 0.0002 }, storage);
  assert.equal(loadModeState("public", storage).feeRate, 0.0007);
  assert.equal(loadModeState("demo", storage).feeRate, 0.0002);
});

test("legacy BTC position migrates into the shared portfolio and resumes paused", () => {
  const migrated = migrateLegacyState({
    mode: "normal",
    portfolio: {
      startingCash: 50_000,
      cash: 10_000,
      btcSats: "39972",
      averageEntryPrice: 100_070_000,
      realizedPnl: 123,
    },
    trades: [],
    candles: [{ startTime: 0, close: 100_000_000, volume: 1 }],
    decisions: [],
    logs: ["legacy"],
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.mode, "public");
  assert.equal(migrated.running, false);
  assert.equal(migrated.portfolio.positionsByMarket["KRW-BTC"].quantityUnits, "39972");
  assert.deepEqual(migrated.markets["KRW-BTC"].candles, [{ startTime: 0, close: 100_000_000, volume: 1 }]);
});

test("legacy demo holdings stay isolated from the public portfolio", () => {
  const legacy = JSON.stringify({
    mode: "demo",
    portfolio: {
      startingCash: 50_000,
      cash: 10_000,
      btcSats: "39972",
      averageEntryPrice: 100_070_000,
    },
    trades: [],
    candles: [],
    decisions: [],
    logs: [],
  });
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: legacy });
  const publicState = loadModeState("public", storage);
  const demoState = loadModeState("demo", storage);

  assert.equal(publicState.mode, "public");
  assert.equal(publicState.portfolio.cash, 50_000);
  assert.deepEqual(publicState.portfolio.positionsByMarket, {});
  assert.equal(demoState.mode, "demo");
  assert.equal(demoState.portfolio.positionsByMarket["KRW-BTC"].quantityUnits, "39972");
});

test("invalid legacy JSON is backed up and replaced with a fresh paused state", () => {
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: "{broken" });
  const state = loadModeState("public", storage);
  assert.equal(state.version, 2);
  assert.equal(state.running, false);
  assert.equal(state.portfolio.cash, 50_000);
  assert.equal(storage.getItem(LEGACY_BACKUP_KEY), "{broken");
});
