import { requireMarket } from "./markets.mjs";

const STARTING_CASH = 50_000;
const MAX_POSITIONS = 2;
const MINIMUM_CASH = 10_000;
const MINIMUM_ORDER = 5_000;

function toFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return number;
}

function validateRate(value, label) {
  const rate = toFiniteNumber(value, label);
  if (rate < 0 || rate > 0.01) throw new Error(`${label}은 0% 이상 1% 이하여야 합니다.`);
  return rate;
}

function serializeFill(fill) {
  return { ...fill, quantityUnits: fill.quantityUnits.toString() };
}

function deserializeFill(fill) {
  return { ...fill, quantityUnits: BigInt(fill.quantityUnits || 0) };
}

export class SharedPortfolio {
  constructor({
    startingCash = STARTING_CASH,
    cash = startingCash,
    positions = new Map(),
    fills = [],
    cumulativeFees = 0,
    realizedPnl = 0,
  } = {}) {
    this.startingCash = Math.round(toFiniteNumber(startingCash, "시작 자금"));
    this.cash = Math.round(toFiniteNumber(cash, "현금"));
    this.positions = positions instanceof Map ? new Map(positions) : new Map();
    this.fills = fills.map((fill) => ({ ...fill }));
    this.cumulativeFees = Math.round(toFiniteNumber(cumulativeFees, "누적 수수료"));
    this.realizedPnl = Math.round(toFiniteNumber(realizedPnl, "실현손익"));
  }

  static fromJSON(payload) {
    if (!payload || typeof payload !== "object") return new SharedPortfolio();
    const positions = new Map();
    for (const [market, raw] of Object.entries(payload.positionsByMarket || {})) {
      requireMarket(market);
      positions.set(market, {
        ...raw,
        market,
        quantityUnits: BigInt(raw.quantityUnits || 0),
      });
    }
    return new SharedPortfolio({
      startingCash: payload.startingCash ?? STARTING_CASH,
      cash: payload.cash ?? payload.startingCash ?? STARTING_CASH,
      positions,
      fills: Array.isArray(payload.fills) ? payload.fills.map(deserializeFill) : [],
      cumulativeFees: payload.cumulativeFees ?? 0,
      realizedPnl: payload.realizedPnl ?? 0,
    });
  }

  get hasPosition() {
    return this.positions.size > 0;
  }

  hasMarket(market) {
    return this.positions.has(market);
  }

  previewBuy({ market, bestAsk, maxOutflow = 20_000, feeRate = 0.0005, slippageRate = 0.0002 }) {
    const metadata = requireMarket(market);
    if (this.positions.has(market)) throw new Error("이미 보유 중인 코인입니다.");
    if (this.positions.size >= MAX_POSITIONS) throw new Error("최대 2종까지만 동시에 보유할 수 있습니다.");

    const cap = Math.floor(toFiniteNumber(maxOutflow, "매수 한도"));
    if (cap < MINIMUM_ORDER) throw new Error("최소 주문금액은 5,000원입니다.");
    if (cap > this.cash - MINIMUM_CASH) throw new Error("매수 후 최소 현금 10,000원을 유지해야 합니다.");

    const fee = validateRate(feeRate, "수수료율");
    const slippage = validateRate(slippageRate, "슬리피지");
    const ask = toFiniteNumber(bestAsk, "최우선 매도호가");
    if (ask <= 0) throw new Error("유효한 최우선 매도호가가 필요합니다.");

    const executionPrice = ask * (1 + slippage);
    const grossAmount = Math.floor(cap / (1 + fee));
    if (grossAmount < MINIMUM_ORDER) throw new Error("최소 주문금액은 5,000원입니다.");
    const tradingFee = Math.floor(grossAmount * fee);
    const cashOutflow = grossAmount + tradingFee;
    if (cashOutflow > cap) throw new Error("매수 한도를 초과했습니다.");

    const quantityUnits = BigInt(Math.floor((grossAmount / executionPrice) * Number(metadata.unitsPerCoin)));
    if (quantityUnits <= 0n) throw new Error("매수 가능한 수량이 없습니다.");

    return {
      market,
      executionPrice,
      quantityUnits,
      grossAmount,
      fee: tradingFee,
      cashOutflow,
    };
  }

  buy({
    market,
    bestAsk,
    maxOutflow = 20_000,
    feeRate = 0.0005,
    slippageRate = 0.0002,
    timestamp = Date.now(),
    candleStart = null,
    reason = "",
    score = 0,
  }) {
    const preview = this.previewBuy({ market, bestAsk, maxOutflow, feeRate, slippageRate });
    const fill = {
      market,
      side: "BUY",
      timestamp: Number(timestamp),
      candleStart,
      executionPrice: preview.executionPrice,
      quantityUnits: preview.quantityUnits,
      grossAmount: preview.grossAmount,
      fee: preview.fee,
      cashDelta: -preview.cashOutflow,
      realizedPnl: 0,
      reason,
      score: Number(score) || 0,
    };

    this.cash += fill.cashDelta;
    this.cumulativeFees += fill.fee;
    this.positions.set(market, {
      market,
      quantityUnits: fill.quantityUnits,
      averageEntryPrice: fill.executionPrice,
      costBasis: preview.cashOutflow,
      buyFee: fill.fee,
      openedAt: fill.timestamp,
      openedCandleStart: candleStart,
    });
    this.fills.unshift(fill);
    return fill;
  }

  sell({
    market,
    bestBid,
    feeRate = 0.0005,
    slippageRate = 0.0002,
    timestamp = Date.now(),
    candleStart = null,
    reason = "",
    score = 0,
  }) {
    const metadata = requireMarket(market);
    const position = this.positions.get(market);
    if (!position) throw new Error("매도할 보유 수량이 없습니다.");

    const fee = validateRate(feeRate, "수수료율");
    const slippage = validateRate(slippageRate, "슬리피지");
    const bid = toFiniteNumber(bestBid, "최우선 매수호가");
    if (bid <= 0) throw new Error("유효한 최우선 매수호가가 필요합니다.");

    const executionPrice = bid * (1 - slippage);
    const grossAmount = Math.floor((Number(position.quantityUnits) / Number(metadata.unitsPerCoin)) * executionPrice);
    const tradingFee = Math.floor(grossAmount * fee);
    const cashDelta = grossAmount - tradingFee;
    const realizedPnl = cashDelta - position.costBasis;
    const fill = {
      market,
      side: "SELL",
      timestamp: Number(timestamp),
      candleStart,
      executionPrice,
      quantityUnits: position.quantityUnits,
      grossAmount,
      fee: tradingFee,
      cashDelta,
      realizedPnl,
      reason,
      score: Number(score) || 0,
    };

    this.cash += cashDelta;
    this.cumulativeFees += tradingFee;
    this.realizedPnl += realizedPnl;
    this.positions.delete(market);
    this.fills.unshift(fill);
    return fill;
  }

  snapshot(quotesByMarket = new Map()) {
    const positions = [];
    let marketValueTotal = 0;
    let unrealizedPnl = 0;

    for (const [market, position] of this.positions) {
      const metadata = requireMarket(market);
      const quote = quotesByMarket instanceof Map ? quotesByMarket.get(market) : quotesByMarket?.[market];
      const markPrice = Number(quote?.tradePrice || position.averageEntryPrice || 0);
      const marketValue = Math.floor((Number(position.quantityUnits) / Number(metadata.unitsPerCoin)) * markPrice);
      const positionPnl = marketValue - position.costBasis;
      marketValueTotal += marketValue;
      unrealizedPnl += positionPnl;
      positions.push({ ...position, symbol: metadata.symbol, koreanName: metadata.koreanName, markPrice, marketValue, unrealizedPnl: positionPnl });
    }

    const totalEquity = this.cash + marketValueTotal;
    return {
      startingCash: this.startingCash,
      cash: this.cash,
      positions,
      positionCount: positions.length,
      marketValue: marketValueTotal,
      totalEquity,
      totalPnl: totalEquity - this.startingCash,
      returnRate: this.startingCash > 0 ? (totalEquity - this.startingCash) / this.startingCash : 0,
      unrealizedPnl,
      realizedPnl: this.realizedPnl,
      cumulativeFees: this.cumulativeFees,
    };
  }

  toJSON() {
    return {
      startingCash: this.startingCash,
      cash: this.cash,
      cumulativeFees: this.cumulativeFees,
      realizedPnl: this.realizedPnl,
      positionsByMarket: Object.fromEntries(
        [...this.positions].map(([market, position]) => [market, { ...position, quantityUnits: position.quantityUnits.toString() }]),
      ),
      fills: this.fills.map(serializeFill),
    };
  }
}
