export const SATS_PER_BTC = 100_000_000n;

export const Signal = Object.freeze({
  BUY: "BUY",
  SELL: "SELL",
  HOLD: "HOLD",
});

export function configForMode(mode = "normal") {
  const common = {
    market: "KRW-BTC",
    startingCash: 50_000,
    buyBudget: 40_000,
    minimumCash: 10_000,
    feeRate: 0.0005,
    slippageRate: 0.0002,
    staleAfterMs: 15_000,
  };
  if (mode === "demo") {
    return { ...common, mode, candleSeconds: 5, fastPeriod: 3, slowPeriod: 7 };
  }
  return { ...common, mode: "normal", candleSeconds: 60, fastPeriod: 5, slowPeriod: 20 };
}

export class CandleBuilder {
  constructor(intervalSeconds) {
    if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      throw new Error("intervalSeconds must be a positive integer");
    }
    this.intervalSeconds = intervalSeconds;
    this.current = null;
  }

  addTrade(timestampMs, price, volume = 0) {
    if (!Number.isFinite(timestampMs) || !Number.isFinite(price) || price <= 0) {
      throw new Error("invalid trade");
    }
    const sizeMs = this.intervalSeconds * 1000;
    const startTime = Math.floor(timestampMs / sizeMs) * sizeMs;
    if (!this.current) {
      this.current = this.#newCandle(startTime, price, volume);
      return null;
    }
    if (startTime < this.current.startTime) {
      return null;
    }
    if (startTime === this.current.startTime) {
      this.current.high = Math.max(this.current.high, price);
      this.current.low = Math.min(this.current.low, price);
      this.current.close = price;
      this.current.volume += Number(volume) || 0;
      return null;
    }
    const completed = { ...this.current };
    this.current = this.#newCandle(startTime, price, volume);
    return completed;
  }

  #newCandle(startTime, price, volume) {
    return {
      startTime,
      intervalSeconds: this.intervalSeconds,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number(volume) || 0,
    };
  }
}

export function sma(values, period) {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export class MovingAverageCrossover {
  constructor(fastPeriod, slowPeriod) {
    if (!Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod) || fastPeriod <= 0 || fastPeriod >= slowPeriod) {
      throw new Error("fastPeriod must be positive and less than slowPeriod");
    }
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
  }

  evaluate(candles, hasPosition) {
    if (!candles.length) throw new Error("at least one candle is required");
    const last = candles.at(-1);
    const required = this.slowPeriod + 1;
    if (candles.length < required) {
      return {
        timestamp: last.startTime + last.intervalSeconds * 1000,
        candleStart: last.startTime,
        signal: Signal.HOLD,
        reason: `이동평균 계산에 ${required}개 봉이 필요합니다 (${candles.length}개 보유).`,
        fastSma: null,
        slowSma: null,
      };
    }
    const closes = candles.map((candle) => candle.close);
    const previous = closes.slice(0, -1);
    const previousFast = sma(previous, this.fastPeriod);
    const previousSlow = sma(previous, this.slowPeriod);
    const currentFast = sma(closes, this.fastPeriod);
    const currentSlow = sma(closes, this.slowPeriod);
    const crossedUp = previousFast <= previousSlow && currentFast > currentSlow;
    const crossedDown = previousFast >= previousSlow && currentFast < currentSlow;

    let signal = Signal.HOLD;
    let reason = "새로운 이동평균 교차가 없습니다.";
    if (crossedUp) {
      if (hasPosition) {
        reason = "단기 이동평균이 상향 돌파했지만 이미 BTC를 보유 중입니다.";
      } else {
        signal = Signal.BUY;
        reason = "단기 이동평균이 장기 이동평균을 상향 돌파했습니다.";
      }
    } else if (crossedDown) {
      if (hasPosition) {
        signal = Signal.SELL;
        reason = "단기 이동평균이 장기 이동평균을 하향 돌파했습니다.";
      } else {
        reason = "단기 이동평균이 하향 돌파했지만 BTC를 미보유 중입니다.";
      }
    }
    return {
      timestamp: last.startTime + last.intervalSeconds * 1000,
      candleStart: last.startTime,
      signal,
      reason: `${reason} 이전 단기/장기=${previousFast.toFixed(2)}/${previousSlow.toFixed(2)}, 현재 단기/장기=${currentFast.toFixed(2)}/${currentSlow.toFixed(2)}.`,
      fastSma: currentFast,
      slowSma: currentSlow,
    };
  }
}

export class PaperBroker {
  constructor(feeRate, slippageRate) {
    this.feeRate = feeRate;
    this.slippageRate = slippageRate;
  }

  buy({ budget, bestAsk, timestamp, reason, candleStart }) {
    if (budget <= 0 || bestAsk <= 0) throw new Error("invalid buy inputs");
    const executionPrice = Math.ceil(bestAsk * (1 + this.slippageRate));
    const fee = Math.max(0, Math.round(budget * this.feeRate));
    const assetBudget = budget - fee;
    const quantitySats = BigInt(Math.floor((assetBudget * 100_000_000) / executionPrice));
    if (quantitySats <= 0n) throw new Error("buy quantity is zero");
    return {
      side: "BUY",
      timestamp,
      candleStart,
      executionPrice,
      quantitySats,
      grossAmount: budget,
      fee,
      netAmount: assetBudget,
      reason,
      realizedPnl: 0,
    };
  }

  sell({ quantitySats, bestBid, timestamp, reason, candleStart }) {
    if (quantitySats <= 0n || bestBid <= 0) throw new Error("invalid sell inputs");
    const executionPrice = Math.floor(bestBid * (1 - this.slippageRate));
    const grossAmount = Number((quantitySats * BigInt(executionPrice)) / SATS_PER_BTC);
    const fee = Math.max(0, Math.round(grossAmount * this.feeRate));
    return {
      side: "SELL",
      timestamp,
      candleStart,
      executionPrice,
      quantitySats,
      grossAmount,
      fee,
      netAmount: grossAmount - fee,
      reason,
      realizedPnl: 0,
    };
  }
}

export class Portfolio {
  constructor({
    startingCash = 50_000,
    minimumCash = 10_000,
    cash = startingCash,
    btcSats = 0n,
    averageEntryPrice = 0,
    realizedPnl = 0,
  } = {}) {
    this.startingCash = Number(startingCash);
    this.minimumCash = Number(minimumCash);
    this.cash = Number(cash);
    this.btcSats = BigInt(btcSats);
    this.averageEntryPrice = Number(averageEntryPrice);
    this.realizedPnl = Number(realizedPnl);
  }

  get hasPosition() {
    return this.btcSats > 0n;
  }

  applyFill(fill) {
    if (fill.side === "BUY") {
      if (this.hasPosition) throw new Error("position already open");
      if (this.cash - fill.grossAmount < this.minimumCash) throw new Error("minimum cash would be violated");
      this.cash -= fill.grossAmount;
      this.btcSats = fill.quantitySats;
      this.averageEntryPrice = Math.ceil((fill.grossAmount * 100_000_000) / Number(fill.quantitySats));
      return 0;
    }
    if (!this.hasPosition || fill.quantitySats !== this.btcSats) throw new Error("sell quantity mismatch");
    const costBasis = Number((this.btcSats * BigInt(this.averageEntryPrice)) / SATS_PER_BTC);
    const realized = fill.netAmount - costBasis;
    this.cash += fill.netAmount;
    this.realizedPnl += realized;
    this.btcSats = 0n;
    this.averageEntryPrice = 0;
    fill.realizedPnl = realized;
    return realized;
  }

  snapshot(markPrice = 0) {
    const btcValue = Number((this.btcSats * BigInt(Math.max(0, Math.round(markPrice)))) / SATS_PER_BTC);
    const totalEquity = this.cash + btcValue;
    const totalPnl = totalEquity - this.startingCash;
    const costBasis = this.hasPosition
      ? Number((this.btcSats * BigInt(this.averageEntryPrice)) / SATS_PER_BTC)
      : 0;
    return {
      startingCash: this.startingCash,
      cash: this.cash,
      btcSats: this.btcSats,
      btcValue,
      totalEquity,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: btcValue - costBasis,
      totalPnl,
      returnRate: totalPnl / this.startingCash,
      averageEntryPrice: this.averageEntryPrice,
      hasPosition: this.hasPosition,
    };
  }

  toJSON() {
    return {
      startingCash: this.startingCash,
      minimumCash: this.minimumCash,
      cash: this.cash,
      btcSats: this.btcSats.toString(),
      averageEntryPrice: this.averageEntryPrice,
      realizedPnl: this.realizedPnl,
    };
  }

  static fromJSON(value, fallbackConfig = configForMode()) {
    if (!value) return new Portfolio({ startingCash: fallbackConfig.startingCash, minimumCash: fallbackConfig.minimumCash });
    return new Portfolio({ ...value, btcSats: BigInt(value.btcSats || "0") });
  }
}

export function serializeFill(fill) {
  return { ...fill, quantitySats: fill.quantitySats.toString() };
}

export function deserializeFill(fill) {
  return { ...fill, quantitySats: BigInt(fill.quantitySats) };
}
