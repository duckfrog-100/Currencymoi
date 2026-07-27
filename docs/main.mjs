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
