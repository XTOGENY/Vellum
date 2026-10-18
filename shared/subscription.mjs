const numeric = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export function subscriptionSummary(sub) {
  const fixed = numeric(sub?.trainingStepsLeft?.fixedTrainingStepsLeft);
  const purchased = numeric(sub?.trainingStepsLeft?.purchasedTrainingSteps);
  const percent = numeric(sub?.usage?.percent);
  const seconds = numeric(sub?.usage?.timeUntilNextPercent);
  const tier = numeric(sub?.tier);
  return {
    plan:
      tier === null
        ? "套餐未知"
        : ["免费账户", "Tablet", "Scroll", "Opus"][tier] || `套餐 ${tier}`,
    active: typeof sub?.active === "boolean" ? sub.active : null,
    fixed,
    purchased,
    balance: fixed !== null && purchased !== null ? fixed + purchased : null,
    percent,
    negative: sub?.usage?.isNegative === true,
    bar:
      percent === null || sub?.usage?.isNegative === true
        ? 0
        : Math.max(0, Math.min(100, percent)),
    refillPerHour: seconds !== null && seconds > 0 ? 3600 / seconds : null,
    refillPaused: seconds === 0,
  };
}
