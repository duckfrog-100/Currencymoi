function parseUtcMinute(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  return Date.parse(normalized);
}

function validPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeMinuteCandles(payload, {
  now = Date.now(),
  limit = 21,
  intervalSeconds = 60,
} = {}) {
  const intervalMs = intervalSeconds * 1_000;
  const byStartTime = new Map();

  for (const item of Array.isArray(payload) ? payload : []) {
    const startTime = parseUtcMinute(item?.candle_date_time_utc);
    const open = validPrice(item?.opening_price);
    const high = validPrice(item?.high_price);
    const low = validPrice(item?.low_price);
    const close = validPrice(item?.trade_price);
    const volume = Math.max(0, Number(item?.candle_acc_trade_volume) || 0);

    if (!Number.isFinite(startTime) || startTime + intervalMs > now) continue;
    if (open == null || high == null || low == null || close == null) continue;
    if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) continue;

    byStartTime.set(startTime, {
      startTime,
      intervalSeconds,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return [...byStartTime.values()]
    .sort((left, right) => left.startTime - right.startTime)
    .slice(-Math.max(1, Number(limit) || 21));
}

export async function fetchMinuteCandleHistory({
  market,
  count = 23,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!market) throw new Error("마켓 코드가 필요합니다.");
  if (typeof fetchImpl !== "function") throw new Error("시세 조회 기능을 사용할 수 없습니다.");

  const url = `https://api.upbit.com/v1/candles/minutes/1?market=${encodeURIComponent(market)}&count=${Math.max(22, Number(count) || 23)}`;
  const response = await fetchImpl(url, { method: "GET", cache: "no-store", signal });
  if (!response.ok) throw new Error(`과거 1분봉 조회 실패: HTTP ${response.status}`);
  const payload = await response.json();
  const candles = normalizeMinuteCandles(payload, { now, limit: 21, intervalSeconds: 60 });
  if (candles.length < 21) throw new Error(`완료된 1분봉이 부족합니다 (${candles.length}/21).`);
  return candles;
}

export async function bootstrapMarketsSequentially(markets, {
  fetchMarket,
  intervalMs = 10_500,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onProgress = () => {},
  isCancelled = () => false,
} = {}) {
  if (typeof fetchMarket !== "function") throw new Error("마켓 조회 함수가 필요합니다.");
  const codes = [...(markets || [])];
  const results = new Map();

  for (let index = 0; index < codes.length; index += 1) {
    if (isCancelled()) break;
    const market = codes[index];
    const candles = await fetchMarket(market);
    results.set(market, candles);
    onProgress({ loaded: index + 1, total: codes.length, market, candles });
    await wait(intervalMs);
  }

  return results;
}

export function buildDemoWarmupCandles({
  now = Date.now(),
  basePrice = 100_000,
  count = 8,
  intervalSeconds = 5,
  phase = 0,
} = {}) {
  const intervalMs = intervalSeconds * 1_000;
  const latestStart = Math.floor(now / intervalMs) * intervalMs - intervalMs;
  const candles = [];
  let previousClose = Math.max(1, Number(basePrice) || 1);

  for (let index = 0; index < count; index += 1) {
    const startTime = latestStart - (count - index - 1) * intervalMs;
    const movement = Math.sin((index + phase) * 0.85) * 0.0025 + (index - count / 2) * 0.00015;
    const close = Math.max(1, previousClose * (1 + movement));
    const open = previousClose;
    const high = Math.max(open, close) * 1.0008;
    const low = Math.min(open, close) * 0.9992;
    candles.push({
      startTime,
      intervalSeconds,
      open,
      high,
      low,
      close,
      volume: 10 + ((index + phase) % 5) * 3,
    });
    previousClose = close;
  }

  return candles;
}
