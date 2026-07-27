import { prepareInitialDashboardState } from "./startup.mjs";

const statusElement = document.querySelector("[data-id='bootstrapStatus']");

try {
  await prepareInitialDashboardState();
} catch (error) {
  if (statusElement) {
    statusElement.textContent = `초기 점수 준비 오류 · ${error.message} · 실시간 데이터 축적으로 계속합니다.`;
    statusElement.dataset.state = "warning";
  }
}

await import("./app.mjs");

if (statusElement?.dataset.state === "ready") {
  const mode = document.querySelector("[data-id='modeSelect']")?.value;
  statusElement.textContent = mode === "demo"
    ? "점수 준비 완료 · 데모 점수는 5초봉이 완성될 때마다 갱신됩니다."
    : "점수 준비 완료 · 공개 점수는 1분봉이 완성될 때마다 갱신되며, 실행 후 새 교차 신호가 생길 때만 거래합니다.";
}
