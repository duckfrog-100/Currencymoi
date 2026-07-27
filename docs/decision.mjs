import { staleLimitForQuote } from "./config.mjs";
import { rankCandidates } from "./scoring.mjs";

function scoreValue(decision) {
  return Number(decision?.score?.total ?? decision?.score ?? 0) || 0;
}

function decisionKey(decision) {
  return `${decision.market}:${decision.candleStart}`;
}

function quoteIsUsable(quote, now, staleAfterMs) {
  if (!quote || !(quote.tradePrice > 0) || !(quote.bestBid > 0) || !(quote.bestAsk > 0)) return false;
  const timestamp = Number(quote.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp <= staleLimitForQuote(quote, staleAfterMs);
}

export function processDecisionBatch({
  decisions,
  portfolio,
  quotes,
  feeRate = 0.0005,
  slippageRate = 0.0002,
  now = Date.now(),
  staleAfterMs,
  processedKeys = new Set(),
}) {
  const fills = [];
  const skipped = [];
  const fresh = [];

  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const key = decisionKey(decision);
    if (processedKeys.has(key)) {
      skipped.push({ market: decision.market, reason: "같은 봉의 중복 판단을 차단했습니다." });
      continue;
    }
    processedKeys.add(key);
    fresh.push(decision);
  }

  const executeSell = (decision) => {
    if (!portfolio.hasMarket(decision.market)) {
      skipped.push({ market: decision.market, reason: "보유하지 않은 코인의 매도 판단입니다." });
      return;
    }
    const quote = quotes instanceof Map ? quotes.get(decision.market) : quotes?.[decision.market];
    if (!quoteIsUsable(quote, now, staleAfterMs)) {
      skipped.push({ market: decision.market, reason: "시세가 오래되었거나 완전하지 않아 거래하지 않았습니다." });
      return;
    }
    try {
      fills.push(portfolio.sell({
        market: decision.market,
        bestBid: quote.bestBid,
        feeRate,
        slippageRate,
        timestamp: now,
        candleStart: decision.candleStart,
        reason: decision.reason,
        score: scoreValue(decision),
      }));
    } catch (error) {
      skipped.push({ market: decision.market, reason: error.message });
    }
  };

  for (const decision of fresh.filter((item) => item.signal === "SELL")) executeSell(decision);

  const buyCandidates = fresh.filter((item) => item.signal === "BUY");

  for (const decision of rankCandidates(buyCandidates)) {
    if (portfolio.positions.size >= 2) {
      skipped.push({ market: decision.market, reason: "최대 2종 보유 한도에 도달했습니다." });
      continue;
    }
    const quote = quotes instanceof Map ? quotes.get(decision.market) : quotes?.[decision.market];
    if (!quoteIsUsable(quote, now, staleAfterMs)) {
      skipped.push({ market: decision.market, reason: "시세가 오래되었거나 완전하지 않아 거래하지 않았습니다." });
      continue;
    }
    try {
      fills.push(portfolio.buy({
        market: decision.market,
        bestAsk: quote.bestAsk,
        maxOutflow: 20_000,
        feeRate,
        slippageRate,
        timestamp: now,
        candleStart: decision.candleStart,
        reason: decision.reason,
        score: scoreValue(decision),
      }));
    } catch (error) {
      skipped.push({ market: decision.market, reason: error.message });
    }
  }

  return { fills, skipped, processedKeys };
}
