import { CandleBuilder, MovingAverageCrossover, Signal } from "./core.mjs";
import { drawPriceChart } from "./chart.mjs";
import { processDecisionBatch } from "./decision.mjs";
import { UpbitBrowserFeed } from "./feed.mjs";
import { MARKETS, MARKET_BY_CODE, marketCodes } from "./markets.mjs";
import { SharedPortfolio } from "./portfolio.mjs";
import { rankCandidates, scoreCandidate } from "./scoring.mjs";
import { createFreshState, loadModeState, saveModeState } from "./state.mjs";

const LAST_MODE_KEY = "currencymoi.portfolio.last-mode";
const MAX_CANDLES = 300;
const MAX_DECISIONS = 100;
const MAX_LOGS = 100;
const MAX_FILLS = 100;
const SLIPPAGE_RATE = 0.0002;

const elements = Object.fromEntries(
  [...document.querySelectorAll("[data-id]")].map((element) => [element.dataset.id, element]),
);

let mode = localStorage.getItem(LAST_MODE_KEY) === "demo" ? "demo" : "public";
let running = false;
let feeRate = 0.0005;
let selectedMarket = "KRW-BTC";
let currentView = "portfolio";
let portfolio = new SharedPortfolio();
let runtimes = new Map();
let logs = [];
let connectionStatus = "연결 대기";
let feed = null;
let demoTimer = null;
let decisionBuckets = new Map();
let processedKeys = new Set();

function modeConfig(targetMode = mode) {
  if (targetMode === "demo") {
    return { candleSeconds: 5, fastPeriod: 3, slowPeriod: 7, staleAfterMs: 8_000 };
  }
  return { candleSeconds: 60, fastPeriod: 5, slowPeriod: 20, staleAfterMs: 35_000 };
}

function emptyScore() {
  return { total: 0, movingAverage: 0, momentum: 0, volume: 0 };
}

function createRuntime(metadata, saved = {}) {
  const config = modeConfig();
  const decisions = Array.isArray(saved.decisions) ? saved.decisions.slice(0, MAX_DECISIONS) : [];
  return {
    metadata,
    builder: new CandleBuilder(config.candleSeconds),
    strategy: new MovingAverageCrossover(config.fastPeriod, config.slowPeriod),
    candles: Array.isArray(saved.candles) ? saved.candles.slice(-MAX_CANDLES) : [],
    decisions,
    latestDecision: decisions[0] || null,
    latestScore: decisions[0]?.score || emptyScore(),
    lastProcessedCandle: saved.lastProcessedCandle ?? null,
    quote: null,
    syntheticPrice: initialSyntheticPrice(metadata.market),
  };
}

function initialSyntheticPrice(market) {
  return {
    "KRW-BTC": 150_000_000,
    "KRW-ETH": 5_000_000,
    "KRW-XRP": 4_000,
    "KRW-SOL": 250_000,
    "KRW-DOGE": 300,
  }[market] || 1_000;
}

function hydrateState(targetMode) {
  const restored = loadModeState(targetMode);
  mode = restored.mode;
  running = false;
  feeRate = Number(restored.feeRate) || 0.0005;
  selectedMarket = MARKET_BY_CODE.has(restored.selectedMarket) ? restored.selectedMarket : "KRW-BTC";
  portfolio = SharedPortfolio.fromJSON(restored.portfolio);
  logs = Array.isArray(restored.logs) ? restored.logs.slice(0, MAX_LOGS) : [];
  runtimes = new Map(
    MARKETS.map((metadata) => [metadata.market, createRuntime(metadata, restored.markets?.[metadata.market])]),
  );
  processedKeys = new Set();
  for (const [market, runtime] of runtimes) {
    if (runtime.lastProcessedCandle != null) processedKeys.add(`${market}:${runtime.lastProcessedCandle}`);
  }
  elements.feeInput.value = (feeRate * 100).toFixed(2);
  elements.modeSelect.value = mode;
}

function statePayload() {
  return {
    version: 2,
    mode,
    running: false,
    feeRate,
    selectedMarket,
    portfolio: portfolio.toJSON(),
    markets: Object.fromEntries(
      [...runtimes].map(([market, runtime]) => [market, {
        candles: runtime.candles.slice(-MAX_CANDLES),
        decisions: runtime.decisions.slice(0, MAX_DECISIONS),
        lastProcessedCandle: runtime.lastProcessedCandle,
      }]),
    ),
    logs: logs.slice(0, MAX_LOGS),
  };
}

function persistState() {
  try {
    saveModeState(mode, statePayload());
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch (error) {
    addLog(`브라우저 저장 실패: ${error.message}`, false);
  }
}

function addLog(message, shouldRender = true) {
  const now = new Date();
  logs.unshift(`[${now.toLocaleTimeString("ko-KR", { hour12: false })}] ${message}`);
  logs = logs.slice(0, MAX_LOGS);
  if (shouldRender) renderLogs();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatKrw(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function formatRate(value) {
  const percent = (Number(value) || 0) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function formatTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "-";
  return new Date(Number(timestamp)).toLocaleString("ko-KR", { hour12: false });
}

function formatQuantity(market, quantityUnits) {
  const metadata = MARKET_BY_CODE.get(market);
  if (!metadata) return "0";
  const quantity = Number(quantityUnits || 0n) / Number(metadata.unitsPerCoin);
  const digits = metadata.symbol === "BTC" || metadata.symbol === "ETH" ? 8 : 6;
  return `${quantity.toFixed(digits)} ${metadata.symbol}`;
}

function signalLabel(signal) {
  if (signal === Signal.BUY) return "매수";
  if (signal === Signal.SELL) return "매도";
  return "관망";
}

function badgeClass(signal) {
  if (signal === Signal.BUY) return "buy";
  if (signal === Signal.SELL) return "sell";
  return "";
}

function quoteMap() {
  return new Map([...runtimes].map(([market, runtime]) => [market, runtime.quote]));
}

function processSnapshot(snapshot) {
  const runtime = runtimes.get(snapshot.market);
  if (!runtime || (mode === "demo" && snapshot.source !== "offline")) return;
  runtime.quote = snapshot;
  if (snapshot.source === "offline") connectionStatus = "오프라인 데모 · 합성 시세";
  else if (snapshot.source === "rest") connectionStatus = "공개 시세 · 약 21초 갱신";
  else connectionStatus = "실시간 WebSocket 연결됨";
  elements.offlineNotice.hidden = snapshot.source !== "rest";
  render();
}

function processTradeTick({ market, timestamp, price, volume }) {
  const runtime = runtimes.get(market);
  if (!runtime) return;
  try {
    const completed = runtime.builder.addTrade(Number(timestamp), Number(price), Number(volume) || 0);
    if (completed) processCompletedCandle(market, completed);
  } catch (error) {
    addLog(`${runtime.metadata.symbol} 시세 처리 실패: ${error.message}`);
  }
}

function processCompletedCandle(market, candle) {
  const runtime = runtimes.get(market);
  runtime.candles.push(candle);
  runtime.candles = runtime.candles.slice(-MAX_CANDLES);

  const evaluated = runtime.strategy.evaluate(runtime.candles, portfolio.hasMarket(market));
  const score = evaluated.fastSma == null || evaluated.slowSma == null
    ? emptyScore()
    : scoreCandidate({ candles: runtime.candles, fastSma: evaluated.fastSma, slowSma: evaluated.slowSma });
  const decision = {
    ...evaluated,
    market,
    score,
    reason: evaluated.reason.replaceAll("BTC", runtime.metadata.symbol),
  };
  runtime.latestDecision = decision;
  runtime.latestScore = score;
  runtime.decisions.unshift(decision);
  runtime.decisions = runtime.decisions.slice(0, MAX_DECISIONS);

  const key = `${market}:${candle.startTime}`;
  if (!running || decision.signal === Signal.HOLD) {
    processedKeys.add(key);
    runtime.lastProcessedCandle = candle.startTime;
    persistState();
    render();
    return;
  }
  queueDecision(decision);
  persistState();
  render();
}

function queueDecision(decision) {
  const bucketKey = decision.candleStart;
  let bucket = decisionBuckets.get(bucketKey);
  if (!bucket) {
    bucket = { decisions: new Map(), timer: null };
    decisionBuckets.set(bucketKey, bucket);
  }
  bucket.decisions.set(decision.market, decision);
  if (!bucket.timer) bucket.timer = setTimeout(() => flushDecisionBucket(bucketKey), 2_000);
}

function flushDecisionBucket(bucketKey) {
  const bucket = decisionBuckets.get(bucketKey);
  if (!bucket) return;
  clearTimeout(bucket.timer);
  decisionBuckets.delete(bucketKey);
  const decisions = [...bucket.decisions.values()];
  const result = processDecisionBatch({
    decisions,
    portfolio,
    quotes: quoteMap(),
    feeRate,
    slippageRate: SLIPPAGE_RATE,
    now: Date.now(),
    staleAfterMs: modeConfig().staleAfterMs,
    processedKeys,
  });
  for (const decision of decisions) {
    const runtime = runtimes.get(decision.market);
    runtime.lastProcessedCandle = decision.candleStart;
  }
  for (const fill of result.fills) {
    const symbol = MARKET_BY_CODE.get(fill.market)?.symbol || fill.market;
    addLog(`가상 ${fill.side === "BUY" ? "매수" : "매도"} 체결 · ${symbol} · ${formatKrw(fill.grossAmount)} · 수수료 ${formatKrw(fill.fee)}`, false);
  }
  for (const item of result.skipped) {
    const symbol = MARKET_BY_CODE.get(item.market)?.symbol || item.market;
    addLog(`${symbol} 주문 보류: ${item.reason}`, false);
  }
  portfolio.fills = portfolio.fills.slice(0, MAX_FILLS);
  persistState();
  render();
}

function clearDecisionBuckets() {
  for (const bucket of decisionBuckets.values()) clearTimeout(bucket.timer);
  decisionBuckets = new Map();
}

function createPublicFeed() {
  return new UpbitBrowserFeed({
    markets: marketCodes(),
    onSnapshot: processSnapshot,
    onTrade: processTradeTick,
    onEvent: (message) => addLog(message),
    onStatus: (status) => {
      connectionStatus = status;
      elements.offlineNotice.hidden = !status.includes("공개 시세");
      render();
    },
    onBlocked: () => {
      elements.offlineNotice.hidden = false;
      render();
    },
  });
}

function startDemoFeed() {
  connectionStatus = "오프라인 데모 · 합성 시세";
  elements.offlineNotice.hidden = true;
  clearInterval(demoTimer);
  demoTimer = setInterval(() => {
    const timestamp = Date.now();
    for (const runtime of runtimes.values()) {
      const movement = (Math.random() - 0.495) * 0.004;
      runtime.syntheticPrice = Math.max(1, runtime.syntheticPrice * (1 + movement));
      const price = Math.max(1, Math.round(runtime.syntheticPrice));
      const spread = Math.max(1, Math.round(price * 0.0001));
      processSnapshot({
        market: runtime.metadata.market,
        timestamp,
        tradePrice: price,
        bestBid: Math.max(1, price - spread),
        bestAsk: price + spread,
        source: "offline",
      });
      processTradeTick({
        market: runtime.metadata.market,
        timestamp,
        price,
        volume: Math.random() * 10,
        source: "offline",
      });
    }
  }, 1_000);
  addLog("실제 거래소 시세와 분리된 5종 합성 데모를 시작했습니다.");
}

function startDataSource() {
  stopDataSource();
  if (mode === "demo") {
    startDemoFeed();
  } else {
    connectionStatus = "실시간 연결 중";
    feed = createPublicFeed();
    feed.connect();
  }
}

function stopDataSource() {
  feed?.disconnect();
  feed = null;
  clearInterval(demoTimer);
  demoTimer = null;
  clearDecisionBuckets();
}

function switchMode(nextMode) {
  const normalized = nextMode === "demo" ? "demo" : "public";
  if (normalized === mode) return;
  running = false;
  persistState();
  stopDataSource();
  hydrateState(normalized);
  localStorage.setItem(LAST_MODE_KEY, normalized);
  addLog(`${normalized === "demo" ? "오프라인 데모" : "공개 시세"} 전용 지갑으로 전환했습니다.`);
  startDataSource();
  render();
}

function resetAccount() {
  if (!window.confirm(`${mode === "demo" ? "오프라인 데모" : "공개 시세"} 지갑과 기록을 50,000원으로 초기화할까요?`)) return;
  running = false;
  clearDecisionBuckets();
  const fresh = createFreshState(mode);
  saveModeState(mode, fresh);
  hydrateState(mode);
  addLog("공동 가상자금 50,000원으로 초기화했습니다.");
  persistState();
  render();
}

function showView(view) {
  currentView = view === "detail" ? "detail" : "portfolio";
  elements.portfolioView.hidden = currentView !== "portfolio";
  elements.detailView.hidden = currentView !== "detail";
  elements.portfolioTab.classList.toggle("active", currentView === "portfolio");
  elements.detailTab.classList.toggle("active", currentView === "detail");
  if (currentView === "detail") requestAnimationFrame(renderDetailChart);
}

function selectMarket(market, openDetail = true) {
  if (!MARKET_BY_CODE.has(market)) return;
  selectedMarket = market;
  persistState();
  if (openDetail) showView("detail");
  render();
}

function render() {
  const snapshot = portfolio.snapshot(quoteMap());
  elements.botStatus.textContent = running ? "실행 중" : "일시정지";
  elements.connectionStatus.textContent = connectionStatus;
  elements.modeStatus.textContent = mode === "demo" ? "데모 · 5초봉 SMA 3/7" : "공개 · 1분봉 SMA 5/20";
  elements.totalEquity.textContent = formatKrw(snapshot.totalEquity);
  elements.totalPnl.textContent = `${snapshot.totalPnl >= 0 ? "+" : ""}${formatKrw(snapshot.totalPnl)} · ${formatRate(snapshot.returnRate)}`;
  elements.cash.textContent = formatKrw(snapshot.cash);
  elements.positionCount.textContent = `${snapshot.positionCount} / 2`;
  elements.cumulativeFees.textContent = formatKrw(snapshot.cumulativeFees);
  elements.startButton.disabled = running;
  elements.pauseButton.disabled = !running;
  elements.modeSelect.value = mode;
  elements.feeInput.value = (feeRate * 100).toFixed(2);
  renderMarketCards();
  renderPositions(snapshot.positions);
  renderRankedDecisions();
  renderFills(elements.combinedFills, portfolio.fills);
  renderDetail();
  renderLogs();
}

function renderMarketCards() {
  elements.marketCards.innerHTML = MARKETS.map((metadata) => {
    const runtime = runtimes.get(metadata.market);
    const quote = runtime.quote;
    const held = portfolio.hasMarket(metadata.market);
    const signal = runtime.latestDecision?.signal || Signal.HOLD;
    const score = Number(runtime.latestScore?.total || 0);
    return `<button type="button" class="market-card ${held ? "held" : ""} ${selectedMarket === metadata.market ? "selected" : ""}" data-market-card="${metadata.market}">
      <div class="market-card-head"><div><div class="market-symbol">${metadata.symbol}</div><div class="market-name">${metadata.koreanName}</div></div><span class="badge ${held ? "buy" : badgeClass(signal)}">${held ? "보유" : signalLabel(signal)}</span></div>
      <div class="market-price">${quote ? formatKrw(quote.tradePrice) : "연결 대기"}</div>
      <div class="market-score"><span>복합 점수</span><strong>${score.toFixed(2)}점</strong></div>
      <div class="score-track"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></div>
      <div class="market-meta">${quote?.source === "rest" ? "공개 REST" : quote?.source === "offline" ? "합성 데모" : quote ? "WebSocket" : "시세 없음"}</div>
    </button>`;
  }).join("");
}

function renderPositions(positions) {
  elements.positionCards.innerHTML = positions.length ? positions.map((position) => {
    const runtime = runtimes.get(position.market);
    const returnRate = position.costBasis > 0 ? position.unrealizedPnl / position.costBasis : 0;
    return `<article class="list-card">
      <div class="list-head"><div><div class="list-title">${position.symbol} · ${position.koreanName}</div><div class="list-subtitle">평균매수가 ${formatKrw(position.averageEntryPrice)}</div></div><div><strong>${formatKrw(position.marketValue)}</strong><div class="list-subtitle">${formatRate(returnRate)}</div></div></div>
      <div class="list-metrics"><div><span>수량</span><strong>${formatQuantity(position.market, position.quantityUnits)}</strong></div><div><span>평가손익</span><strong>${formatKrw(position.unrealizedPnl)}</strong></div><div><span>매수 수수료</span><strong>${formatKrw(position.buyFee)}</strong></div><div><span>현재 점수</span><strong>${Number(runtime.latestScore?.total || 0).toFixed(2)}점</strong></div></div>
    </article>`;
  }).join("") : '<div class="empty-state">아직 보유 중인 코인이 없습니다.</div>';
}

function renderRankedDecisions() {
  const ranked = rankCandidates(MARKETS.map((metadata) => ({
    market: metadata.market,
    score: runtimes.get(metadata.market).latestScore?.total || 0,
    decision: runtimes.get(metadata.market).latestDecision,
  })));
  elements.rankedDecisions.innerHTML = ranked.map((item, index) => {
    const metadata = MARKET_BY_CODE.get(item.market);
    const decision = item.decision;
    const runtime = runtimes.get(item.market);
    return `<article class="list-card">
      <div class="list-head"><div><span class="badge">${index + 1}위</span><div class="list-title">${metadata.symbol} · ${signalLabel(decision?.signal)}</div></div><strong>${Number(item.score || 0).toFixed(2)}점</strong></div>
      <div class="list-subtitle">${escapeHtml(decision?.reason || "완료된 봉을 기다리는 중입니다.")}</div>
      <div class="list-metrics"><div><span>이동평균</span><strong>${Number(runtime.latestScore?.movingAverage || 0).toFixed(2)} / 50</strong></div><div><span>상승률</span><strong>${Number(runtime.latestScore?.momentum || 0).toFixed(2)} / 30</strong></div><div><span>거래량</span><strong>${Number(runtime.latestScore?.volume || 0).toFixed(2)} / 20</strong></div></div>
    </article>`;
  }).join("");
}

function fillCard(fill) {
  const metadata = MARKET_BY_CODE.get(fill.market);
  return `<article class="fill-card">
    <div class="fill-head"><div><div class="fill-title"><span class="badge ${fill.side === "BUY" ? "buy" : "sell"}">${fill.side === "BUY" ? "매수" : "매도"}</span> ${metadata?.symbol || fill.market}</div><div class="fill-subtitle">${formatTime(fill.timestamp)} · ${escapeHtml(fill.reason)}</div></div><strong>${formatKrw(fill.grossAmount)}</strong></div>
    <div class="fill-grid"><div><span>체결가</span><strong>${formatKrw(fill.executionPrice)}</strong></div><div><span>수량</span><strong>${formatQuantity(fill.market, fill.quantityUnits)}</strong></div><div><span>수수료</span><strong>${formatKrw(fill.fee)}</strong></div><div><span>현금 증감</span><strong>${formatKrw(fill.cashDelta)}</strong></div><div><span>실현손익</span><strong>${formatKrw(fill.realizedPnl)}</strong></div><div><span>신호 점수</span><strong>${Number(fill.score || 0).toFixed(2)}점</strong></div></div>
  </article>`;
}

function renderFills(container, fills) {
  container.innerHTML = fills.length ? fills.slice(0, 30).map(fillCard).join("") : '<div class="empty-state">아직 가상 거래가 없습니다.</div>';
}

function renderDetail() {
  const metadata = MARKET_BY_CODE.get(selectedMarket);
  const runtime = runtimes.get(selectedMarket);
  const quote = runtime.quote;
  const position = portfolio.positions.get(selectedMarket);
  const score = runtime.latestScore || emptyScore();
  elements.selectedSymbol.textContent = metadata.symbol;
  elements.selectedKoreanName.textContent = metadata.koreanName;
  elements.detailPrice.textContent = quote ? formatKrw(quote.tradePrice) : "연결 대기";
  elements.detailBestBid.textContent = quote ? formatKrw(quote.bestBid) : "-";
  elements.detailBestAsk.textContent = quote ? formatKrw(quote.bestAsk) : "-";
  elements.detailPosition.textContent = position ? `보유 · ${formatQuantity(selectedMarket, position.quantityUnits)}` : "미보유";
  elements.detailScore.textContent = `${Number(score.total || 0).toFixed(2)}점`;
  elements.detailSignal.textContent = signalLabel(runtime.latestDecision?.signal);
  elements.scoreMa.textContent = `${Number(score.movingAverage || 0).toFixed(2)} / 50`;
  elements.scoreMomentum.textContent = `${Number(score.momentum || 0).toFixed(2)} / 30`;
  elements.scoreVolume.textContent = `${Number(score.volume || 0).toFixed(2)} / 20`;
  elements.scoreMaBar.value = Number(score.movingAverage || 0);
  elements.scoreMomentumBar.value = Number(score.momentum || 0);
  elements.scoreVolumeBar.value = Number(score.volume || 0);
  document.querySelectorAll("[data-market]").forEach((button) => button.classList.toggle("active", button.dataset.market === selectedMarket));
  renderOrderPreview(metadata, quote, position);
  renderFills(elements.detailFills, portfolio.fills.filter((fill) => fill.market === selectedMarket));
  elements.detailDecisions.innerHTML = runtime.decisions.length ? runtime.decisions.slice(0, 20).map((decision) => `<article class="list-card"><div class="list-head"><div class="list-title">${signalLabel(decision.signal)} · ${formatTime(decision.timestamp)}</div><strong>${Number(decision.score?.total || 0).toFixed(2)}점</strong></div><div class="list-subtitle">${escapeHtml(decision.reason)}</div></article>`).join("") : '<div class="empty-state">완료된 봉을 기다리는 중입니다.</div>';
  if (currentView === "detail") renderDetailChart();
}

function renderOrderPreview(metadata, quote, position) {
  if (!quote) {
    elements.orderPreview.innerHTML = '<div class="empty-state">현재 호가가 수신되면 예상 주문 비용을 표시합니다.</div>';
    return;
  }
  if (position) {
    const executionPrice = quote.bestBid * (1 - SLIPPAGE_RATE);
    const grossAmount = Math.floor((Number(position.quantityUnits) / Number(metadata.unitsPerCoin)) * executionPrice);
    const fee = Math.floor(grossAmount * feeRate);
    const net = grossAmount - fee;
    elements.orderPreview.innerHTML = `<div><span>예상 매도 체결가</span><strong>${formatKrw(executionPrice)}</strong></div><div><span>보유 수량</span><strong>${formatQuantity(metadata.market, position.quantityUnits)}</strong></div><div><span>예상 매도대금</span><strong>${formatKrw(grossAmount)}</strong></div><div><span>예상 수수료</span><strong>${formatKrw(fee)}</strong></div><div><span>예상 입금액</span><strong>${formatKrw(net)}</strong></div><div><span>설정 수수료율</span><strong>${(feeRate * 100).toFixed(2)}%</strong></div>`;
    return;
  }
  try {
    const preview = portfolio.previewBuy({ market: metadata.market, bestAsk: quote.bestAsk, maxOutflow: 20_000, feeRate, slippageRate: SLIPPAGE_RATE });
    elements.orderPreview.innerHTML = `<div><span>총 사용 한도</span><strong>20,000원</strong></div><div><span>예상 매수 체결가</span><strong>${formatKrw(preview.executionPrice)}</strong></div><div><span>코인 매수금액</span><strong>${formatKrw(preview.grossAmount)}</strong></div><div><span>예상 수수료</span><strong>${formatKrw(preview.fee)}</strong></div><div><span>총 현금 차감</span><strong>${formatKrw(preview.cashOutflow)}</strong></div><div><span>예상 수량</span><strong>${formatQuantity(metadata.market, preview.quantityUnits)}</strong></div>`;
  } catch (error) {
    elements.orderPreview.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderDetailChart() {
  const runtime = runtimes.get(selectedMarket);
  if (!runtime || !elements.chart) return;
  const fills = portfolio.fills.filter((fill) => fill.market === selectedMarket);
  drawPriceChart(elements.chart, runtime.candles, fills, modeConfig());
}

function renderLogs() {
  elements.logs.textContent = logs.length ? logs.join("\n") : "시스템 로그가 여기에 표시됩니다.";
}

elements.startButton.addEventListener("click", () => {
  running = true;
  addLog("멀티코인 모의 자동매매를 시작했습니다.");
  persistState();
  render();
});

elements.pauseButton.addEventListener("click", () => {
  running = false;
  clearDecisionBuckets();
  addLog("모의 자동매매를 일시정지했습니다.");
  persistState();
  render();
});

elements.resetButton.addEventListener("click", resetAccount);
elements.modeSelect.addEventListener("change", (event) => switchMode(event.target.value));
elements.feeInput.addEventListener("change", (event) => {
  const percent = Number(event.target.value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
    event.target.value = (feeRate * 100).toFixed(2);
    addLog("수수료율은 0.00% 이상 1.00% 이하로 입력해야 합니다.");
    return;
  }
  feeRate = percent / 100;
  addLog(`거래 수수료율을 ${percent.toFixed(2)}%로 변경했습니다.`);
  persistState();
  render();
});

elements.portfolioTab.addEventListener("click", () => showView("portfolio"));
elements.detailTab.addEventListener("click", () => showView("detail"));
elements.backToPortfolio.addEventListener("click", () => showView("portfolio"));
elements.marketCards.addEventListener("click", (event) => {
  const card = event.target.closest("[data-market-card]");
  if (card) selectMarket(card.dataset.marketCard, true);
});
document.querySelectorAll("[data-market]").forEach((button) => button.addEventListener("click", () => selectMarket(button.dataset.market, false)));
window.addEventListener("resize", () => { if (currentView === "detail") renderDetailChart(); });
window.addEventListener("beforeunload", persistState);

hydrateState(mode);
addLog("멀티코인 포트폴리오 대시보드를 시작했습니다.", false);
showView("portfolio");
render();
startDataSource();
setInterval(() => render(), 5_000);
