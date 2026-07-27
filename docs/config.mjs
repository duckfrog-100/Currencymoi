export function strategyConfigForMode(mode = "public") {
  if (mode === "demo") {
    return {
      mode: "demo",
      candleSeconds: 5,
      fastPeriod: 3,
      slowPeriod: 7,
      staleAfterMs: 8_000,
    };
  }
  return {
    mode: "public",
    candleSeconds: 60,
    fastPeriod: 5,
    slowPeriod: 20,
    staleAfterMs: undefined,
  };
}
