import {
  CandleBuilder,
  MovingAverageCrossover,
  PaperBroker,
  Portfolio,
  Signal,
  configForMode,
  deserializeFill,
  serializeFill,
} from "./core.mjs";
import { UpbitBrowserFeed } from "./feed.mjs";
import { drawPriceChart } from "./chart.mjs";

const STORAGE_KEY = "currencymoi.github-pages.v1";
const MAX_CANDLES = 300;
const MAX_TRADES = 100;
const MAX_DECISIONS = 100;
const MAX_LOGS = 100;

const elements = Object.fromEntries(
  [...document.querySelectorAll("[data-id]")].map((element) => [element.dataset.id, element]),
);

let restored = loadSavedState();
let mode = restored?.mode === "demo" ? "demo" : "normal";
let config = configForMode(mode);
let portfolio = Portfolio.fromJSON(restored?.portfolio, config);
let candles = Array.isArray(restored?.candles) ? restored.candles.slice(-MAX_CANDLES) : [];
let trades = Array.isArray(restored?.trades) ? restored.trades.map(deserializeFill).slice(0, MAX_TRADES) : [];
let decisions = Array.isArray(restored?.decisions) ? restored.decisions.slice(0, MAX_DECISIONS) : [];
let logs = Array.isArray(restored?.logs) ? restored.logs.slice(0, MAX_LOGS) : [];
let lastProcessedCandle = restored?.lastProcessedCandle ?? null;
let running = false;
let market = null;
let connectionStatus = "연결 대기";
let offlineDemo = false;
let demoTimer = null;
let syntheticPrice = 100_000_000;
let builder;
let strategy;
let broker;

function rebuildStrategy() {
  config = configForMode(mode);
  builder = new CandleBuilder(config.candleSeconds);
  strategy = new MovingAverageCrossover(config.fastPeriod, config.slowPeriod);
  broker = new PaperBroker(config.feeRate, config.slippageRate);
}

rebuildStrategy();

function loadSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function persistState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode,
        portfolio: portfolio.toJSON(),
        candles: candles.slice(-MAX_CANDLES),
        trades: trades.slice(0, MAX_TRADES).map(serializeFill),
        decisions: decisions.slice(0, MAX_DECISIONS),
        logs: logs.slice(0, MAX_LOGS),
        lastProcessedCandle,
        running: false,
      }),
    );
  } catch (error) {
    addLog(`브라우저 저장 실패: ${error.message}`);
  }
}

function addLog(message) {
  const now = new Date();
  logs.unshift(`[${now.toLocaleTimeString("ko-KR", { hour12: false })}] ${message}`);
  logs = logs.slice(0, MAX_LOGS);
}

function formatKrw(value) {
  return `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
}

function formatRate(value) {
  const percent = (value || 0) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function formatBtc(sats) {
  return (Number(sats) / 100_000_000).toFixed(8);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString("ko-KR", { hour12: false });
}

function processMarketSnapshot(snapshot) {
  market = snapshot;
  connectionStatus = offlineDemo ? "오프라인 데모" : "실시간 연결됨";
}

function processTradeTick(timestamp, price, volume) {
  const completed = builder.addTrade(timestamp, price, volume);
  if (completed) processCompletedCandle(completed);
}

function processCompletedCandle(candle) {
  candles.push(candle);
  candles = candles.slice(-MAX_CANDLES);
  const decision = strategy.evaluate(candles, portfolio.hasPosition);
  decisions.unshift(decision);
  decisions = decisions.slice(0, MAX_DECISIONS);

  if (lastProcessedCandle === candle.startTime) {
    addLog("이미 처리한 봉의 중복 주문을 차단했습니다.");
    persistState();
    return;
  }
  lastProcessedCandle = candle.startTime;
  if (!running || decision.signal === Signal.HOLD) {
    persistState();
    return;
  }
  if (!market || Date.now() - market.timestamp > config.staleAfterMs) {
    addLog("시세가 오래되어 가상 주문을 생성하지 않았습니다.");
    persistState();
    return;
  }

  try {
    let fill;
    if (decision.signal === Signal.BUY) {
      fill = broker.buy({
        budget: config.buyBudget,
        bestAsk: market.bestAsk,
        timestamp: Date.now(),
        reason: decision.reason,
        candleStart: candle.startTime,
      });
    } else {
      fill = broker.sell({
        quantitySats: portfolio.btcSats,
        bestBid: market.bestBid,
        timestamp: Date.now(),
        reason: decision.reason,
        candleStart: candle.startTime,
      });
    }
    portfolio.applyFill(fill);
    trades.unshift(fill);
    trades = trades.slice(0, MAX_TRADES);
    addLog(`가상 ${fill.side === "BUY" ? "매수" : "매도"} 체결: ${formatKrw(fill.grossAmount)} · ${formatKrw(fill.executionPrice)}`);
  } catch (error) {
    addLog(`가상 주문 차단: ${error.message}`);
  }
  persistState();
}

const feed = new UpbitBrowserFeed({
  market: config.market,
  onSnapshot: processMarketSnapshot,
  onTrade: processTradeTick,
  onEvent: addLog,
  onStatus: (status) => {
    connectionStatus = status;
    render();
  },
  onBlocked: () => {
    elements.offlineNotice.hidden = false;
    render();
  },
});

function startOfflineDemo() {
  feed.disconnect();
  offlineDemo = true;
  elements.offlineNotice.hidden = true;
  connectionStatus = "오프라인 데모";
  syntheticPrice = market?.tradePrice || syntheticPrice;
  addLog("실제 주문과 무관한 오프라인 데모 시세를 시작했습니다.");
  clearInterval(demoTimer);
  demoTimer = setInterval(() => {
    const movement = (Math.random() - 0.49) * 0.002;
    syntheticPrice = Math.max(1_000, Math.round((syntheticPrice * (1 + movement)) / 1_000) * 1_000);
    const timestamp = Date.now();
    processMarketSnapshot({
      timestamp,
      tradePrice: syntheticPrice,
      bestBid: syntheticPrice - 1_000,
      bestAsk: syntheticPrice + 1_000,
    });
    processTradeTick(timestamp, syntheticPrice, Math.random() * 0.001);
  }, 1_000);
  render();
}

function stopOfflineDemo() {
  offlineDemo = false;
  clearInterval(demoTimer);
  demoTimer = null;
  market = null;
  connectionStatus = "실시간 연결 중";
  addLog("오프라인 데모를 종료하고 실제 공개 시세 연결을 시도합니다.");
  feed.connect();
  render();
}

function changeMode(nextMode) {
  if (nextMode === mode) return;
  running = false;
  mode = nextMode;
  candles = [];
  decisions = [];
  lastProcessedCandle = null;
  rebuildStrategy();
  addLog(`전략 모드를 ${mode === "demo" ? "데모" : "일반"}로 변경했습니다.`);
  persistState();
  render();
}

function resetAccount() {
  if (!window.confirm("가상 지갑과 거래 기록을 지우고 50,000원으로 초기화할까요?")) return;
  running = false;
  portfolio = new Portfolio({ startingCash: 50_000, minimumCash: 10_000 });
  candles = [];
  trades = [];
  decisions = [];
  logs = [];
  lastProcessedCandle = null;
  rebuildStrategy();
  addLog("가상 자금 50,000원으로 초기화했습니다.");
  persistState();
  render();
}

function render() {
  const markPrice = market?.tradePrice || portfolio.averageEntryPrice || 0;
  const snapshot = portfolio.snapshot(markPrice);
  elements.botStatus.textContent = running ? "실행 중" : "일시정지";
  elements.connectionStatus.textContent = connectionStatus;
  elements.modeStatus.textContent = mode === "demo" ? "데모 · 5초봉" : "일반 · 1분봉";
  elements.positionStatus.textContent = snapshot.hasPosition ? "BTC 보유" : "현금 보유";
  elements.currentPrice.textContent = market ? formatKrw(market.tradePrice) : "연결 대기";
  elements.bestBid.textContent = market ? formatKrw(market.bestBid) : "-";
  elements.bestAsk.textContent = market ? formatKrw(market.bestAsk) : "-";
  elements.totalEquity.textContent = formatKrw(snapshot.totalEquity);
  elements.totalPnl.textContent = `${snapshot.totalPnl >= 0 ? "+" : ""}${formatKrw(snapshot.totalPnl)}`;
  elements.cash.textContent = formatKrw(snapshot.cash);
  elements.btcValue.textContent = formatKrw(snapshot.btcValue);
  elements.btcQuantity.textContent = formatBtc(snapshot.btcSats);
  elements.returnRate.textContent = formatRate(snapshot.returnRate);
  elements.realizedPnl.textContent = formatKrw(snapshot.realizedPnl);
  elements.lastDecision.textContent = decisions[0]?.reason || "완료된 봉을 기다리는 중입니다.";
  elements.lastAction.textContent = trades[0]
    ? `${trades[0].side === "BUY" ? "매수" : "매도"} · ${formatKrw(trades[0].grossAmount)}`
    : "아직 가상 거래가 없습니다.";
  elements.startButton.disabled = running;
  elements.pauseButton.disabled = !running;
  elements.modeSelect.value = mode;
  elements.offlineButton.textContent = offlineDemo ? "실시간 시세 다시 연결" : "오프라인 데모로 보기";
  renderTrades();
  renderDecisions();
  renderLogs();
  drawPriceChart(elements.chart, candles, trades, config);
}

function renderTrades() {
  elements.tradeRows.innerHTML = trades.length
    ? trades.slice(0, 20).map((trade) => `
      <tr>
        <td>${formatTime(trade.timestamp)}</td>
        <td><span class="trade-chip ${trade.side.toLowerCase()}">${trade.side === "BUY" ? "매수" : "매도"}</span></td>
        <td>${formatKrw(trade.executionPrice)}</td>
        <td>${formatBtc(trade.quantitySats)}</td>
        <td>${formatKrw(trade.grossAmount)}</td>
        <td>${formatKrw(trade.fee)}</td>
        <td>${formatKrw(trade.realizedPnl || 0)}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">아직 가상 거래가 없습니다.</td></tr>`;
}

function renderDecisions() {
  elements.decisionRows.innerHTML = decisions.length
    ? decisions.slice(0, 20).map((decision) => `
      <tr>
        <td>${formatTime(decision.timestamp)}</td>
        <td>${decision.signal}</td>
        <td>${decision.fastSma == null ? "-" : formatKrw(decision.fastSma)}</td>
        <td>${decision.slowSma == null ? "-" : formatKrw(decision.slowSma)}</td>
        <td>${decision.reason}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty">완료된 봉을 기다리는 중입니다.</td></tr>`;
}

function renderLogs() {
  elements.logs.textContent = logs.length ? logs.join("\n") : "시스템 로그가 여기에 표시됩니다.";
}

elements.startButton.addEventListener("click", () => {
  running = true;
  addLog("모의 자동매매를 시작했습니다.");
  persistState();
  render();
});

elements.pauseButton.addEventListener("click", () => {
  running = false;
  addLog("모의 자동매매를 일시정지했습니다.");
  persistState();
  render();
});

elements.resetButton.addEventListener("click", resetAccount);
elements.modeSelect.addEventListener("change", (event) => changeMode(event.target.value));
elements.offlineButton.addEventListener("click", () => (offlineDemo ? stopOfflineDemo() : startOfflineDemo()));
window.addEventListener("resize", () => drawPriceChart(elements.chart, candles, trades, config));
window.addEventListener("beforeunload", persistState);

addLog("GitHub Pages 모의투자 대시보드를 시작했습니다.");
render();
feed.connect();
setInterval(render, 1_000);
