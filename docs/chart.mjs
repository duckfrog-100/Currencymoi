export function drawPriceChart(canvas, candles, trades, config) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(600, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(360 * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);

  const data = candles.slice(-120);
  if (data.length < 2) {
    ctx.fillStyle = "#8f9bb7";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("실시간 봉 데이터가 쌓이면 가격과 이동평균이 표시됩니다.", width / 2, height / 2);
    return;
  }

  const closes = data.map((item) => item.close);
  const rolling = (period) => data.map((_, index) => {
    const values = closes.slice(0, index + 1);
    return values.length >= period
      ? values.slice(-period).reduce((sum, value) => sum + value, 0) / period
      : null;
  });
  const fast = rolling(config.fastPeriod);
  const slow = rolling(config.slowPeriod);
  const allValues = [...closes, ...fast.filter(Number.isFinite), ...slow.filter(Number.isFinite)];
  let min = Math.min(...allValues);
  let max = Math.max(...allValues);
  const padding = Math.max((max - min) * 0.12, max * 0.0005);
  min -= padding;
  max += padding;

  const left = 62;
  const right = 16;
  const top = 20;
  const bottom = 34;
  const x = (index) => left + (index / (data.length - 1)) * (width - left - right);
  const y = (value) => top + ((max - value) / (max - min)) * (height - top - bottom);

  ctx.strokeStyle = "#202a44";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#7f8aa5";
  ctx.font = "11px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const yy = top + ((height - top - bottom) * i) / 4;
    const value = max - ((max - min) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(width - right, yy);
    ctx.stroke();
    ctx.fillText(Math.round(value).toLocaleString("ko-KR"), left - 8, yy + 4);
  }

  const drawLine = (values, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    let started = false;
    values.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      if (!started) {
        ctx.moveTo(x(index), y(value));
        started = true;
      } else {
        ctx.lineTo(x(index), y(value));
      }
    });
    ctx.stroke();
  };
  drawLine(closes, "#ffffff", 1.5);
  drawLine(fast, "#4da3ff", 2);
  drawLine(slow, "#f5b942", 2);

  const firstStart = data[0].startTime;
  const lastStart = data.at(-1).startTime;
  trades
    .filter((trade) => trade.candleStart >= firstStart && trade.candleStart <= lastStart)
    .forEach((trade) => {
      const index = data.findIndex((candle) => candle.startTime === trade.candleStart);
      if (index < 0) return;
      ctx.fillStyle = trade.side === "BUY" ? "#36d399" : "#ff6b7a";
      ctx.beginPath();
      ctx.arc(x(index), y(trade.executionPrice), 5, 0, Math.PI * 2);
      ctx.fill();
    });

  ctx.textAlign = "left";
  ctx.fillStyle = "#4da3ff";
  ctx.fillText(`SMA ${config.fastPeriod}`, left, height - 10);
  ctx.fillStyle = "#f5b942";
  ctx.fillText(`SMA ${config.slowPeriod}`, left + 72, height - 10);
}
