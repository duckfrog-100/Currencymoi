export function buildWebSocketSubscription(markets, ticket) {
  const codes = [...markets];
  return [
    { ticket },
    { type: "ticker", codes, is_only_realtime: true },
    { type: "trade", codes, is_only_realtime: true },
    { type: "orderbook", codes, is_only_realtime: true },
    { format: "DEFAULT" },
  ];
}

export function normalizeRestOrderbooks(payload, fallbackTimestamp = Date.now()) {
  const result = new Map();
  for (const item of Array.isArray(payload) ? payload : []) {
    const market = item?.market;
    const unit = item?.orderbook_units?.[0];
    const bestBid = Number(unit?.bid_price);
    const bestAsk = Number(unit?.ask_price);
    if (!market || !(bestBid > 0) || !(bestAsk > 0) || bestBid > bestAsk) continue;
    result.set(market, {
      market,
      timestamp: Number(item.timestamp || fallbackTimestamp),
      bestBid,
      bestAsk,
      source: "rest",
    });
  }
  return result;
}

export function normalizeRestOrderbook(payload, fallbackTimestamp = Date.now()) {
  const normalized = normalizeRestOrderbooks(payload, fallbackTimestamp);
  const first = normalized.values().next().value;
  if (!first) throw new Error("유효한 최우선 호가가 없습니다.");
  return {
    timestamp: first.timestamp,
    tradePrice: Math.round((first.bestBid + first.bestAsk) / 2),
    bestBid: first.bestBid,
    bestAsk: first.bestAsk,
    source: "rest",
  };
}

export function normalizeRestTickers(payload, previousByMarket = new Map(), fallbackTimestamp = Date.now()) {
  const result = new Map();
  for (const item of Array.isArray(payload) ? payload : []) {
    const market = item?.market;
    const tradePrice = Number(item?.trade_price);
    const accumulatedVolume = Number(item?.acc_trade_volume_24h);
    if (!market || !(tradePrice > 0) || !Number.isFinite(accumulatedVolume)) continue;
    const previous = previousByMarket instanceof Map ? previousByMarket.get(market) : previousByMarket?.[market];
    const previousVolume = Number(previous?.accumulatedVolume);
    const volumeDelta = Number.isFinite(previousVolume)
      ? Math.max(0, accumulatedVolume - previousVolume)
      : 0;
    result.set(market, {
      market,
      timestamp: Number(item.timestamp || fallbackTimestamp),
      tradePrice,
      accumulatedVolume,
      volumeDelta,
      source: "rest",
    });
  }
  return result;
}

function emptyMarketState() {
  return {
    tradePrice: null,
    bestBid: null,
    bestAsk: null,
    tickerTimestamp: 0,
    orderbookTimestamp: 0,
    accumulatedVolume: null,
  };
}

export class UpbitBrowserFeed {
  constructor({ markets, market, onSnapshot, onTrade, onEvent, onStatus, onBlocked }) {
    this.markets = Array.isArray(markets) && markets.length ? [...markets] : [market].filter(Boolean);
    if (!this.markets.length) throw new Error("최소 한 개의 마켓이 필요합니다.");
    this.marketSet = new Set(this.markets);
    this.onSnapshot = onSnapshot || (() => {});
    this.onTrade = onTrade || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onBlocked = onBlocked || (() => {});
    this.socket = null;
    this.reconnectTimer = null;
    this.restStartTimer = null;
    this.restInterval = null;
    this.activeController = null;
    this.restConnected = false;
    this.restPhase = "orderbook";
    this.manualClose = false;
    this.failedAttempts = 0;
    this.receivedData = false;
    this.stateByMarket = new Map(this.markets.map((code) => [code, emptyMarketState()]));
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.stopRestFallback();
    this.manualClose = false;
    this.receivedData = false;
    this.onStatus("실시간 연결 중");

    let socket;
    try {
      socket = new WebSocket("wss://api.upbit.com/websocket/v1");
    } catch (error) {
      this.onEvent(`업비트 WebSocket 연결을 시작하지 못했습니다: ${error.message}`);
      this.handleWebSocketClose();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.onStatus("실시간 연결됨");
      const ticket = globalThis.crypto?.randomUUID?.() || `currencymoi-${Date.now()}`;
      socket.send(JSON.stringify(buildWebSocketSubscription(this.markets, ticket)));
      this.onEvent("업비트 공개 실시간 시세에 연결되었습니다.");
    });

    socket.addEventListener("message", async (event) => {
      try {
        let text;
        if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(event.data);
        } else if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          text = await event.data.text();
        } else {
          text = String(event.data);
        }
        const payload = JSON.parse(text);
        for (const item of Array.isArray(payload) ? payload : [payload]) this.handleItem(item);
      } catch (error) {
        this.onEvent(`시세 메시지를 무시했습니다: ${error.message}`);
      }
    });

    socket.addEventListener("error", () => {
      this.onStatus("연결 오류");
      this.onEvent("업비트 WebSocket 연결 오류가 발생했습니다.");
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.manualClose) return;
      this.handleWebSocketClose();
    });
  }

  handleWebSocketClose() {
    this.failedAttempts = this.receivedData ? 1 : this.failedAttempts + 1;
    this.receivedData = false;
    clearTimeout(this.reconnectTimer);
    if (this.failedAttempts >= 2) {
      this.onBlocked();
      this.startRestFallback();
      return;
    }
    this.onStatus("재연결 대기");
    this.onEvent("시세 연결이 종료되어 10초 후 한 번 더 연결합니다.");
    this.reconnectTimer = setTimeout(() => this.connect(), 10_500);
  }

  startRestFallback() {
    if (this.restStartTimer || this.restInterval) return;
    clearTimeout(this.reconnectTimer);
    this.onStatus("공개 시세 전환 대기");
    this.onEvent("WebSocket 연결이 어려워 업비트 공개 시세 API의 배치 조회 방식으로 전환합니다.");
    this.restStartTimer = setTimeout(async () => {
      this.restStartTimer = null;
      await this.pollRestOnce();
      if (!this.manualClose) this.restInterval = setInterval(() => this.pollRestOnce(), 10_500);
    }, 10_500);
  }

  async pollRestOnce() {
    if (this.manualClose || this.activeController) return;
    const controller = new AbortController();
    this.activeController = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const marketQuery = encodeURIComponent(this.markets.join(","));
    const phase = this.restPhase;
    const url = phase === "orderbook"
      ? `https://api.upbit.com/v1/orderbook?markets=${marketQuery}`
      : `https://api.upbit.com/v1/ticker?markets=${marketQuery}`;

    try {
      const response = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (phase === "orderbook") {
        for (const [market, quote] of normalizeRestOrderbooks(payload)) {
          if (!this.marketSet.has(market)) continue;
          Object.assign(this.stateByMarket.get(market), {
            bestBid: quote.bestBid,
            bestAsk: quote.bestAsk,
            orderbookTimestamp: quote.timestamp,
          });
        }
        this.restPhase = "ticker";
      } else {
        const previous = new Map(
          [...this.stateByMarket].map(([market, state]) => [market, { accumulatedVolume: state.accumulatedVolume }]),
        );
        for (const [market, ticker] of normalizeRestTickers(payload, previous)) {
          if (!this.marketSet.has(market)) continue;
          Object.assign(this.stateByMarket.get(market), {
            tradePrice: ticker.tradePrice,
            tickerTimestamp: ticker.timestamp,
            accumulatedVolume: ticker.accumulatedVolume,
          });
          this.onTrade({
            market,
            timestamp: ticker.timestamp,
            price: ticker.tradePrice,
            volume: ticker.volumeDelta,
            source: "rest",
          });
        }
        this.restPhase = "orderbook";
      }

      this.emitRestSnapshots();
      this.onStatus("공개 시세 · 약 21초 갱신");
      if (!this.restConnected) {
        this.restConnected = true;
        this.onEvent("업비트 공개 시세 API에 연결되었습니다. 5개 마켓을 배치로 갱신합니다.");
      }
    } catch (error) {
      this.onStatus("공개 시세 연결 오류");
      this.onEvent(`공개 시세 조회 오류: ${error.name === "AbortError" ? "응답 시간 초과" : error.message}`);
    } finally {
      clearTimeout(timeout);
      this.activeController = null;
    }
  }

  emitRestSnapshots() {
    const now = Date.now();
    for (const market of this.markets) {
      const state = this.stateByMarket.get(market);
      const oldestTimestamp = Math.min(state.tickerTimestamp || 0, state.orderbookTimestamp || 0);
      if (!oldestTimestamp || now - oldestTimestamp > 35_000) continue;
      this.emitSnapshot(market, Math.max(state.tickerTimestamp, state.orderbookTimestamp), "rest");
    }
  }

  stopRestFallback() {
    clearTimeout(this.restStartTimer);
    clearInterval(this.restInterval);
    this.activeController?.abort();
    this.activeController = null;
    this.restStartTimer = null;
    this.restInterval = null;
    this.restConnected = false;
    this.restPhase = "orderbook";
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.stopRestFallback();
    this.socket?.close();
    this.socket = null;
  }

  handleItem(item) {
    if (!item || typeof item !== "object") return;
    const market = item.code || item.market;
    if (!this.marketSet.has(market)) return;
    const state = this.stateByMarket.get(market);

    if (item.type === "orderbook") {
      const unit = item.orderbook_units?.[0];
      const bestBid = Number(unit?.bid_price);
      const bestAsk = Number(unit?.ask_price);
      if (!(bestBid > 0) || !(bestAsk > 0) || bestBid > bestAsk) return;
      state.bestBid = bestBid;
      state.bestAsk = bestAsk;
      state.orderbookTimestamp = Number(item.timestamp || Date.now());
      this.receivedData = true;
      this.failedAttempts = 0;
      this.emitSnapshot(market, state.orderbookTimestamp, "websocket");
      return;
    }

    if (item.type === "ticker") {
      const price = Number(item.trade_price);
      if (!(price > 0)) return;
      state.tradePrice = price;
      state.tickerTimestamp = Number(item.timestamp || Date.now());
      this.receivedData = true;
      this.failedAttempts = 0;
      this.emitSnapshot(market, state.tickerTimestamp, "websocket");
      return;
    }

    if (item.type === "trade") {
      const timestamp = Number(item.trade_timestamp || item.timestamp || Date.now());
      const price = Number(item.trade_price);
      if (!(price > 0)) return;
      state.tradePrice = price;
      state.tickerTimestamp = timestamp;
      if (item.best_bid_price != null) state.bestBid = Number(item.best_bid_price);
      if (item.best_ask_price != null) state.bestAsk = Number(item.best_ask_price);
      this.receivedData = true;
      this.failedAttempts = 0;
      this.emitSnapshot(market, timestamp, "websocket");
      this.onTrade({
        market,
        timestamp,
        price,
        volume: Math.max(0, Number(item.trade_volume) || 0),
        source: "websocket",
      });
    }
  }

  emitSnapshot(market, timestamp, source) {
    const state = this.stateByMarket.get(market);
    if (!(state?.tradePrice > 0) || !(state.bestBid > 0) || !(state.bestAsk > 0)) return;
    this.onSnapshot({
      market,
      timestamp: Number(timestamp || Date.now()),
      tradePrice: state.tradePrice,
      bestBid: state.bestBid,
      bestAsk: state.bestAsk,
      source,
    });
  }
}
