import { MARKETS } from "./markets.mjs";
import { SharedPortfolio } from "./portfolio.mjs";

export const LEGACY_STORAGE_KEY = "currencymoi.github-pages.v1";
export const LEGACY_BACKUP_KEY = "currencymoi.github-pages.v1.backup";

const STORAGE_KEYS = Object.freeze({
  public: "currencymoi.portfolio.public.v2",
  demo: "currencymoi.portfolio.demo.v2",
});

function normalizeMode(mode) {
  return mode === "demo" ? "demo" : "public";
}

function emptyMarketStates() {
  return Object.fromEntries(MARKETS.map(({ market }) => [market, {
    candles: [],
    decisions: [],
    lastProcessedCandle: null,
  }]));
}

export function storageKeyForMode(mode) {
  return STORAGE_KEYS[normalizeMode(mode)];
}

export function createFreshState(mode = "public") {
  const normalizedMode = normalizeMode(mode);
  return {
    version: 2,
    mode: normalizedMode,
    running: false,
    feeRate: 0.0005,
    selectedMarket: "KRW-BTC",
    portfolio: new SharedPortfolio().toJSON(),
    markets: emptyMarketStates(),
    logs: [],
  };
}

function normalizeVersionTwoState(value, mode) {
  const fresh = createFreshState(mode);
  const markets = emptyMarketStates();
  for (const { market } of MARKETS) {
    const source = value?.markets?.[market];
    if (!source || typeof source !== "object") continue;
    markets[market] = {
      candles: Array.isArray(source.candles) ? source.candles.slice(-300) : [],
      decisions: Array.isArray(source.decisions) ? source.decisions.slice(0, 100) : [],
      lastProcessedCandle: source.lastProcessedCandle ?? null,
    };
  }
  const feeRate = Number(value?.feeRate);
  return {
    ...fresh,
    ...value,
    version: 2,
    mode: normalizeMode(mode),
    running: false,
    feeRate: Number.isFinite(feeRate) && feeRate >= 0 && feeRate <= 0.01 ? feeRate : 0.0005,
    selectedMarket: MARKETS.some(({ market }) => market === value?.selectedMarket)
      ? value.selectedMarket
      : "KRW-BTC",
    portfolio: SharedPortfolio.fromJSON(value?.portfolio).toJSON(),
    markets,
    logs: Array.isArray(value?.logs) ? value.logs.slice(0, 100) : [],
  };
}

function legacyFill(fill) {
  const side = fill?.side === "SELL" ? "SELL" : "BUY";
  const grossAmount = Number(fill?.grossAmount || 0);
  const fee = Number(fill?.fee || 0);
  return {
    market: "KRW-BTC",
    side,
    timestamp: Number(fill?.timestamp || Date.now()),
    candleStart: fill?.candleStart ?? null,
    executionPrice: Number(fill?.executionPrice || 0),
    quantityUnits: String(fill?.quantitySats || 0),
    grossAmount,
    fee,
    cashDelta: side === "BUY" ? -grossAmount : Math.max(0, grossAmount - fee),
    realizedPnl: Number(fill?.realizedPnl || 0),
    reason: String(fill?.reason || "이전 버전 거래"),
    score: 0,
  };
}

export function migrateLegacyState(payload) {
  if (!payload || typeof payload !== "object") throw new Error("이전 상태를 읽을 수 없습니다.");
  const mode = payload.mode === "demo" ? "demo" : "public";
  const fresh = createFreshState(mode);
  const oldPortfolio = payload.portfolio && typeof payload.portfolio === "object" ? payload.portfolio : {};
  const startingCash = Number(oldPortfolio.startingCash ?? 50_000);
  const cash = Number(oldPortfolio.cash ?? startingCash);
  const btcUnits = BigInt(oldPortfolio.btcSats || 0);
  const averageEntryPrice = Number(oldPortfolio.averageEntryPrice || 0);
  const positionsByMarket = {};
  if (btcUnits > 0n) {
    const costBasis = Math.floor((Number(btcUnits) / 100_000_000) * averageEntryPrice);
    positionsByMarket["KRW-BTC"] = {
      market: "KRW-BTC",
      quantityUnits: btcUnits.toString(),
      averageEntryPrice,
      costBasis,
      buyFee: 0,
      openedAt: null,
      openedCandleStart: null,
    };
  }
  const fills = Array.isArray(payload.trades) ? payload.trades.map(legacyFill) : [];
  const cumulativeFees = fills.reduce((sum, fill) => sum + Math.max(0, Number(fill.fee) || 0), 0);

  fresh.portfolio = {
    startingCash: Number.isFinite(startingCash) ? startingCash : 50_000,
    cash: Number.isFinite(cash) ? cash : 50_000,
    cumulativeFees,
    realizedPnl: Number(oldPortfolio.realizedPnl || 0),
    positionsByMarket,
    fills,
  };
  fresh.markets["KRW-BTC"] = {
    candles: Array.isArray(payload.candles) ? payload.candles.slice(-300) : [],
    decisions: Array.isArray(payload.decisions) ? payload.decisions.slice(0, 100) : [],
    lastProcessedCandle: payload.lastProcessedCandle ?? null,
  };
  fresh.logs = Array.isArray(payload.logs) ? payload.logs.slice(0, 100) : [];
  fresh.running = false;
  return fresh;
}

export function saveModeState(mode, state, storage = globalThis.localStorage) {
  if (!storage?.setItem) throw new Error("브라우저 저장소를 사용할 수 없습니다.");
  const normalized = normalizeVersionTwoState(state, mode);
  storage.setItem(storageKeyForMode(mode), JSON.stringify(normalized));
  return normalized;
}

export function loadModeState(mode, storage = globalThis.localStorage) {
  if (!storage?.getItem || !storage?.setItem) return createFreshState(mode);
  const normalizedMode = normalizeMode(mode);
  const key = storageKeyForMode(normalizedMode);
  const currentRaw = storage.getItem(key);
  if (currentRaw) {
    try {
      const parsed = JSON.parse(currentRaw);
      if (parsed?.version !== 2) throw new Error("지원하지 않는 상태 버전입니다.");
      return normalizeVersionTwoState(parsed, normalizedMode);
    } catch {
      storage.setItem(`${key}.backup`, currentRaw);
      const fresh = createFreshState(normalizedMode);
      storage.setItem(key, JSON.stringify(fresh));
      return fresh;
    }
  }

  if (normalizedMode === "public") {
    const legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      try {
        const migrated = migrateLegacyState(JSON.parse(legacyRaw));
        const migratedMode = normalizeMode(migrated.mode);
        const normalizedMigrated = normalizeVersionTwoState(migrated, migratedMode);
        storage.setItem(storageKeyForMode(migratedMode), JSON.stringify(normalizedMigrated));
        storage.removeItem?.(LEGACY_STORAGE_KEY);

        if (migratedMode === "public") return normalizedMigrated;

        const freshPublic = createFreshState("public");
        storage.setItem(key, JSON.stringify(freshPublic));
        return freshPublic;
      } catch {
        storage.setItem(LEGACY_BACKUP_KEY, legacyRaw);
        const fresh = createFreshState("public");
        storage.setItem(key, JSON.stringify(fresh));
        return fresh;
      }
    }
  }

  const fresh = createFreshState(normalizedMode);
  storage.setItem(key, JSON.stringify(fresh));
  return fresh;
}
