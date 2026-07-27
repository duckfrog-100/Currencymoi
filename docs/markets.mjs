const marketDefinitions = [
  { market: "KRW-BTC", symbol: "BTC", koreanName: "비트코인", unitsPerCoin: 100_000_000n },
  { market: "KRW-ETH", symbol: "ETH", koreanName: "이더리움", unitsPerCoin: 100_000_000n },
  { market: "KRW-XRP", symbol: "XRP", koreanName: "리플", unitsPerCoin: 1_000_000n },
  { market: "KRW-SOL", symbol: "SOL", koreanName: "솔라나", unitsPerCoin: 1_000_000n },
  { market: "KRW-DOGE", symbol: "DOGE", koreanName: "도지코인", unitsPerCoin: 1_000_000n },
];

export const MARKETS = Object.freeze(
  marketDefinitions.map((definition, tieBreakIndex) => Object.freeze({ ...definition, tieBreakIndex })),
);

export const MARKET_BY_CODE = new Map(MARKETS.map((market) => [market.market, market]));

export function marketCodes() {
  return MARKETS.map((market) => market.market);
}

export function requireMarket(marketCode) {
  const market = MARKET_BY_CODE.get(marketCode);
  if (!market) throw new Error(`지원하지 않는 마켓입니다: ${marketCode}`);
  return market;
}
