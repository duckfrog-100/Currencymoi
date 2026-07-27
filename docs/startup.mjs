import {
  bootstrapMarketsSequentially,
  buildDemoWarmupCandles,
  fetchMinuteCandleHistory,
} from "./history.mjs";
import { MARKETS, MARKET_BY_CODE, marketCodes } from "./markets.mjs";
import { loadModeState, saveModeState } from "./state.mjs";
import { applyMarketWarmup, historyNeedsRefresh } from "./warmup-state.mjs";

const LAST_MODE_KEY = "currencymoi.portfolio.last-mode";
const PUBLIC_HISTORY_MAX_AGE_MS = 10 * 60_000;
const REQUEST_INTERVAL_MS = 10_500;

const DEMO_BASE_PRICES = Object.freeze({
  "KRW-BTC": 150_000_000,
  "KRW-ETH": 5_000_000,
  "KRW-XRP": 4_000,
  "KRW-SOL": 250_000,
  "KRW-DOGE": 300,
});

function setStatus(element, message, state = "loading") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

export function setBootstrapControls(controls, preparing) {
  const isPreparing = Boolean(preparing);
  if (controls?.startButton) {
    controls.startButton.disabled = isPreparing;
    controls.startButton.textContent = isPreparing ? "점수 준비 중" : "▶ 시작";
  }
  if (controls?.pauseButton) controls.pauseButton.disabled = isPreparing;
  if (controls?.resetButton) controls.resetButton.disabled = isPreparing;
  if (controls?.feeInput) controls.feeInput.disabled = isPreparing;
}

function hasPosition(state, market) {
  return Boolean(state?.portfolio?.positionsByMarket?.[market]);
}

function appendStartupLog(state, message) {
  return {
    ...state,
    logs: [`[초기 준비] ${message}`, ...(Array.isArray(state.logs) ? state.logs : [])].slice(0, 100),
  };
}

function prepareDemoState(storage, now) {
  let state = loadModeState("demo", storage);
  for (const [index, metadata] of MARKETS.entries()) {
    const existing = state.markets?.[metadata.market]?.candles;
    if (!historyNeedsRefresh(existing, {
      now,
      required: 8,
      intervalSeconds: 5,
      maximumAgeMs: 60_000,
    })) continue;

    const candles = buildDemoWarmupCandles({
      now,
      basePrice: DEMO_BASE_PRICES[metadata.market],
      count: 8,
      intervalSeconds: 5,
      phase: index * 2,
    });
    state = applyMarketWarmup(state, metadata.market, candles, {
      hasPosition: hasPosition(state, metadata.market),
      fastPeriod: 3,
      slowPeriod: 7,
      sourceLabel: "합성 초기 봉",
    });
  }
  saveModeState("demo", state, storage);
  return state;
}

async function preparePublicState({ storage, fetchImpl, statusElement, now }) {
  let state = loadModeState("public", storage);
  const pendingMarkets = marketCodes().filter((market) => historyNeedsRefresh(
    state.markets?.[market]?.candles,
    { now, maximumAgeMs: PUBLIC_HISTORY_MAX_AGE_MS },
  ));

  if (!pendingMarkets.length) {
    setStatus(statusElement, "점수 준비 완료 · 저장된 최근 1분봉을 사용합니다.", "ready");
    return state;
  }

  let successCount = 0;
  setStatus(
    statusElement,
    `초기 점수 준비 0/${pendingMarkets.length} · 코인별 과거 1분봉을 불러오는 중입니다.`,
  );

  await bootstrapMarketsSequentially(pendingMarkets, {
    intervalMs: REQUEST_INTERVAL_MS,
    fetchMarket: async (market) => {
      try {
        return {
          candles: await fetchMinuteCandleHistory({ market, fetchImpl }),
          error: null,
        };
      } catch (error) {
        return { candles: null, error };
      }
    },
    onProgress: ({ loaded, total, market, candles: result }) => {
      const symbol = MARKET_BY_CODE.get(market)?.symbol || market;
      if (result?.candles) {
        state = applyMarketWarmup(state, market, result.candles, {
          hasPosition: hasPosition(state, market),
          sourceLabel: "과거 1분봉",
        });
        successCount += 1;
        setStatus(statusElement, `초기 점수 준비 ${loaded}/${total} · ${symbol} 완료`, "loading");
      } else {
        const message = result?.error?.message || "알 수 없는 오류";
        state = appendStartupLog(state, `${symbol} 과거 봉 조회 실패: ${message}`);
        setStatus(statusElement, `초기 점수 준비 ${loaded}/${total} · ${symbol} 조회 실패`, "warning");
      }
      saveModeState("public", state, storage);
    },
  });

  const stateName = successCount === pendingMarkets.length ? "ready" : "warning";
  setStatus(
    statusElement,
    `초기 점수 준비 완료 · ${successCount}/${pendingMarkets.length}개 코인 점수 계산 · 실시간 시세 연결 중`,
    stateName,
  );
  return state;
}

export async function prepareInitialDashboardState({
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const statusElement = documentRef?.querySelector?.("[data-id='bootstrapStatus']") || null;
  const modeSelect = documentRef?.querySelector?.("[data-id='modeSelect']") || null;
  const controls = {
    startButton: documentRef?.querySelector?.("[data-id='startButton']") || null,
    pauseButton: documentRef?.querySelector?.("[data-id='pauseButton']") || null,
    resetButton: documentRef?.querySelector?.("[data-id='resetButton']") || null,
    feeInput: documentRef?.querySelector?.("[data-id='feeInput']") || null,
  };
  const mode = storage?.getItem?.(LAST_MODE_KEY) === "demo" ? "demo" : "public";

  if (modeSelect) modeSelect.value = mode;
  setBootstrapControls(controls, true);

  const reloadOnModeChange = (event) => {
    const nextMode = event.target.value === "demo" ? "demo" : "public";
    storage?.setItem?.(LAST_MODE_KEY, nextMode);
    globalThis.location?.reload?.();
  };
  modeSelect?.addEventListener?.("change", reloadOnModeChange, { once: true });

  try {
    if (mode === "demo") {
      setStatus(statusElement, "오프라인 데모 초기 점수를 준비하는 중입니다.");
      prepareDemoState(storage, now);
      setStatus(statusElement, "데모 점수 준비 완료 · 5초마다 점수가 갱신됩니다.", "ready");
      return;
    }

    await preparePublicState({ storage, fetchImpl, statusElement, now });
  } finally {
    modeSelect?.removeEventListener?.("change", reloadOnModeChange);
    setBootstrapControls(controls, false);
  }
}
