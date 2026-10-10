import type { RiskFactors, RiskInputs, RiskLevel } from '@cleanloop/shared';

/** Starting weights from the project brief; tune them with `npm run backtest`. */
export const DEFAULT_WEIGHTS: RiskFactors = {
  pastReports: 0.3,
  daysSincePickup: 0.25,
  missedStops: 0.2,
  rain: 0.15,
  eventDay: 0.1,
};

/** Each factor saturates at 1 when its raw input reaches this value. */
export const SATURATION = {
  reportsSameWeekday: 2,
  daysSincePickup: 3,
  skippedLast7: 2,
  rainMm: 10,
};

export const LEVEL_THRESHOLDS = { medium: 35, high: 65 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function riskFactors(inputs: RiskInputs): RiskFactors {
  const rainProb = inputs.rainProbability === null ? 0 : inputs.rainProbability / 100;
  const rainAmount = inputs.rainMm === null ? 0 : inputs.rainMm / SATURATION.rainMm;
  return {
    pastReports: clamp01(inputs.reportsSameWeekday / SATURATION.reportsSameWeekday),
    daysSincePickup:
      inputs.daysSincePickup === null
        ? 1
        : clamp01(inputs.daysSincePickup / SATURATION.daysSincePickup),
    missedStops: clamp01(inputs.skippedLast7 / SATURATION.skippedLast7),
    // Probability and volume both matter: a likely drizzle and an unlikely downpour are
    // both moderate risks for wet-waste weight.
    rain: clamp01(0.6 * clamp01(rainProb) + 0.4 * clamp01(rainAmount)),
    eventDay: inputs.eventLabel ? 1 : 0,
  };
}

export function riskLevel(score: number): RiskLevel {
  if (score > LEVEL_THRESHOLDS.high) return 'high';
  if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function computeRisk(
  inputs: RiskInputs,
  weights: RiskFactors = DEFAULT_WEIGHTS,
): { score: number; level: RiskLevel; factors: RiskFactors } {
  const factors = riskFactors(inputs);
  const raw =
    weights.pastReports * factors.pastReports +
    weights.daysSincePickup * factors.daysSincePickup +
    weights.missedStops * factors.missedStops +
    weights.rain * factors.rain +
    weights.eventDay * factors.eventDay;
  const score = Math.round(100 * raw);
  return { score, level: riskLevel(score), factors };
}
