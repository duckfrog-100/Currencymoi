import { MovingAverageCrossover } from "./core.mjs";
import { MARKET_BY_CODE } from "./markets.mjs";
import { scoreCandidate } from "./scoring.mjs";

export function historyNeedsRefresh(candles, {
  now = Date.now(),
  required = 21,
  intervalSeconds = 60,
  maximumAgeMs = 10 * 60_000,
} = {}) {
  if (!Array.isArray(candles) || candles.length < required) return true;
  const latest = candles.at(-1);
  const completedAt = Number(latest?.startTime) + intervalSeconds * 1_000;
  if (!Number.isFinite(completedAt)) return true;
  return now - completedAt > maximumAgeMs;
}

export function applyMarketWarmup(state, market, candles, {
  hasPosition = false,
  fastPeriod = 5,
  slowPeriod = 20,
  sourceLabel = "과거 1분봉",
} = {}) {
  if (!state || typeof state !== "object") throw new Error("저장 상태가 필요합니다.");
  if (!MARKET_BY_CODE.has(market)) throw new Error(`지원하지 않는 마켓입니다: ${market}`);
  if (!Array.isArray(candles) || candles.length < slowPeriod + 1) {
    throw new Error(`점수 계산에 ${slowPeriod + 1}개 봉이 필요합니다.`);
  }

  const strategy = new MovingAverageCrossover(fastPeriod, slowPeriod);
  const evaluated = strategy.evaluate(candles, hasPosition);
  const score = scoreCandidate({
    candles,
    fastSma: evaluated.fastSma,
    slowSma: evaluated.slowSma,
  });
  const symbol = MARKET_BY_CODE.get(market)?.symbol || market;
  const decision = {
    ...evaluated,
    market,
    score,
    reason: `${sourceLabel} ${candles.length}개로 초기 점수를 계산했습니다. ${evaluated.reason.replaceAll("BTC", symbol)}`,
    warmup: true,
  };

  const previousMarketState = state.markets?.[market] || {};
  const previousDecisions = Array.isArray(previousMarketState.decisions)
    ? previousMarketState.decisions.filter((item) => item?.candleStart !== decision.candleStart)
    : [];

  return {
    ...state,
    running: false,
    markets: {
      ...(state.markets || {}),
      [market]: {
        ...previousMarketState,
        candles: candles.slice(-300),
        decisions: [decision, ...previousDecisions].slice(0, 100),
        lastProcessedCandle: previousMarketState.lastProcessedCandle ?? null,
      },
    },
  };
}
