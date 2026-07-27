import { MARKET_BY_CODE } from "./markets.mjs";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function scoreCandidate({ candles, fastSma, slowSma }) {
  const safeCandles = Array.isArray(candles) ? candles : [];
  const latest = safeCandles.at(-1);

  const movingAverageRaw = Number.isFinite(fastSma) && Number.isFinite(slowSma) && slowSma > 0
    ? (fastSma - slowSma) / slowSma
    : 0;
  const movingAverage = clamp(movingAverageRaw / 0.01, 0, 1) * 50;

  const momentumBase = safeCandles.length >= 4 ? safeCandles.at(-4)?.close : null;
  const momentumRaw = Number.isFinite(latest?.close) && Number.isFinite(momentumBase) && momentumBase > 0
    ? (latest.close - momentumBase) / momentumBase
    : 0;
  const momentum = clamp(momentumRaw / 0.03, 0, 1) * 30;

  const previousFive = safeCandles.length >= 6 ? safeCandles.slice(-6, -1) : [];
  const averageVolume = previousFive.length === 5
    ? previousFive.reduce((sum, candle) => sum + Math.max(0, Number(candle.volume) || 0), 0) / 5
    : 0;
  const latestVolume = Math.max(0, Number(latest?.volume) || 0);
  const volumeRatio = averageVolume > 0 ? latestVolume / averageVolume : 0;
  const volume = clamp((volumeRatio - 1) / 2, 0, 1) * 20;

  return {
    total: round2(movingAverage + momentum + volume),
    movingAverage: round2(movingAverage),
    momentum: round2(momentum),
    volume: round2(volume),
  };
}

export function rankCandidates(candidates) {
  return [...(candidates || [])].sort((left, right) => {
    const leftScore = Number(left.score?.total ?? left.score ?? 0);
    const rightScore = Number(right.score?.total ?? right.score ?? 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    const leftOrder = MARKET_BY_CODE.get(left.market)?.tieBreakIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = MARKET_BY_CODE.get(right.market)?.tieBreakIndex ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}
