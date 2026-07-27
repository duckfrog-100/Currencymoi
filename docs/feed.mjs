export class UpbitBrowserFeed {
  constructor({ market, onSnapshot, onTrade, onEvent, onStatus, onBlocked }) {
    this.market = market;
    this.onSnapshot = onSnapshot;
    this.onTrade = onTrade;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.onBlocked = onBlocked;
    this.socket = null;
    this.reconnectTimer = null;
    this.manualClose = false;
    this.failedAttempts = 0;
    this.tradePrice = null;
    this.bestBid = null;
    this.bestAsk = null;
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.manualClose = false;
    this.onStatus("실시간 연결 중");
    const socket = new WebSocket("wss://api.upbit.com/websocket/v1");
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.failedAttempts = 0;
      this.onStatus("실시간 연결됨");
      const ticket = globalThis.crypto?.randomUUID?.() || `currencymoi-${Date.now()}`;
      socket.send(JSON.stringify([
        { ticket },
        { type: "ticker", codes: [this.market], is_only_realtime: true },
        { type: "trade", codes: [this.market], is_only_realtime: true },
        { type: "orderbook", codes: [`${this.market}.5`], is_only_realtime: true },
        { format: "DEFAULT" },
      ]));
      this.onEvent("업비트 공개 실시간 시세에 연결되었습니다.");
    });

    socket.addEventListener("message", async (event) => {
      try {
        let text;
        if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(event.data);
        } else if (event.data instanceof Blob) {
          text = await event.data.text();
        } else {
          text = String(event.data);
        }
        const payload = JSON.parse(text);
        const messages = Array.isArray(payload) ? payload : [payload];
        for (const item of messages) this.handleItem(item);
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
      this.failedAttempts += 1;
      this.onStatus("재연결 대기");
      this.onEvent("시세 연결이 종료되어 10초 후 재연결합니다.");
      if (this.failedAttempts >= 2) this.onBlocked();
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 10_000);
    });
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  handleItem(item) {
    if (!item || typeof item !== "object") return;
    if (item.type === "orderbook") {
      const unit = item.orderbook_units?.[0];
      if (!unit) return;
      this.bestBid = Number(unit.bid_price);
      this.bestAsk = Number(unit.ask_price);
      this.emitSnapshot(Number(item.timestamp || Date.now()));
      return;
    }
    if (item.type === "ticker") {
      this.tradePrice = Number(item.trade_price);
      this.emitSnapshot(Number(item.timestamp || Date.now()));
      return;
    }
    if (item.type === "trade") {
      const timestamp = Number(item.trade_timestamp || Date.now());
      const price = Number(item.trade_price);
      this.tradePrice = price;
      if (item.best_bid_price != null) this.bestBid = Number(item.best_bid_price);
      if (item.best_ask_price != null) this.bestAsk = Number(item.best_ask_price);
      this.emitSnapshot(timestamp);
      this.onTrade(timestamp, price, Number(item.trade_volume || 0));
    }
  }

  emitSnapshot(timestamp) {
    if (!(this.tradePrice > 0) || !(this.bestBid > 0) || !(this.bestAsk > 0)) return;
    this.onSnapshot({
      timestamp,
      tradePrice: this.tradePrice,
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
    });
  }
}
