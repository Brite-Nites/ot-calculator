/* Overtime engine — Brite Nites
 *
 * Single source of truth for all overtime math. The calculator page inlines
 * this file; validate.js tests it against real payroll history.
 *
 * RATE CONSTANTS CURRENT AS OF: January 2026
 * Review every January 1. What moves: California minimum wage, and therefore
 * the California exempt salary threshold.
 *
 * This file does not and cannot track law changes. Verify before relying on it.
 */

const RULES = {
  FED: {
    label: 'Federal — VA, UT, AZ, WA, DC/MD, NC, PA, NY, CT, FL, TX',
    weeklyThreshold: 40,
    dailyOtAfter: null,      // no daily overtime
    dailyDtAfter: null,      // no double time
    seventhDay: false,
  },
  CA: {
    label: 'California',
    weeklyThreshold: 40,
    dailyOtAfter: 8,
    dailyDtAfter: 12,
    seventhDay: true,        // 1.5x first 8 hrs, 2x beyond
  },
  CO: {
    label: 'Colorado',
    weeklyThreshold: 40,
    dailyOtAfter: 12,        // 1.5x over 12/day. Colorado has NO double time.
    dailyDtAfter: null,
    seventhDay: false,
    // NOT MODELLED: Colorado also owes overtime after 12 CONSECUTIVE hours,
    // which can span two calendar days. That needs shift start/end times,
    // not daily totals. See scope.md "Known limitations".
  },
};

const WORKWEEK_START = 'Monday';   // matches Deputy

/* Compute one workweek.
 *   rate        — base hourly rate
 *   hoursByDay  — array of hours worked per day, Monday first. Length = days worked.
 *   stateKey    — 'FED' | 'CA' | 'CO'
 * Returns { reg, ot, dt, cost, blended }
 *
 * California no-pyramiding, per DIR: daily overtime is counted first, then only
 * the remaining straight-time hours (hours 1-8 of each day) count toward the
 * weekly 40 threshold.
 */
function computeWeek(rate, hoursByDay, stateKey) {
  const r = RULES[stateKey];
  if (!r) throw new Error(`Unknown ruleset: ${stateKey}`);

  const otRate = rate * 1.5;
  const dtRate = rate * 2;

  let reg = 0, ot = 0, dt = 0;

  // Seventh-day premium applies to the seventh CONSECUTIVE day WORKED in the
  // workweek. Testing array length was a bug: [8,8,8,8,8,0,8] is six days
  // worked with a gap, not seven consecutive. Count days actually worked.
  const daysWorked = hoursByDay.filter((h) => h > 0).length;
  const isSeventhDay = (i) => r.seventhDay && daysWorked === 7 && i === 6;

  hoursByDay.forEach((h, i) => {
    if (h <= 0) return;

    if (isSeventhDay(i)) {
      // Seventh consecutive day in the workweek: 1.5x first 8, 2x beyond.
      // No straight-time hours at all, so nothing here feeds the weekly 40.
      ot += Math.min(h, 8);
      dt += Math.max(h - 8, 0);
      return;
    }

    if (r.dailyOtAfter === null) {
      // No daily rule — all hours are straight time at this stage. Weekly
      // threshold is applied below.
      reg += h;
      return;
    }

    const straight = Math.min(h, r.dailyOtAfter);
    reg += straight;

    if (r.dailyDtAfter !== null) {
      ot += Math.max(Math.min(h, r.dailyDtAfter) - r.dailyOtAfter, 0);
      dt += Math.max(h - r.dailyDtAfter, 0);
    } else {
      ot += Math.max(h - r.dailyOtAfter, 0);
    }
  });

  // Weekly threshold: straight-time hours beyond 40 convert to overtime.
  if (reg > r.weeklyThreshold) {
    const excess = reg - r.weeklyThreshold;
    reg = r.weeklyThreshold;
    ot += excess;
  }

  const cost = reg * rate + ot * otRate + dt * dtRate;
  const total = reg + ot + dt;

  return {
    reg: round2(reg),
    ot: round2(ot),
    dt: round2(dt),
    total: round2(total),
    cost: round2(cost),
    blended: total > 0 ? round2(cost / total) : 0,
  };
}

/* Convenience: even-split a weekly hour total across N days.
 *
 * WARNING — in California and Colorado this SYSTEMATICALLY UNDERSTATES cost.
 * Double-time and daily overtime trigger on individual long days; averaging
 * minimises how many hours clear those lines. The error is always low, never
 * high. Prefer per-day entry when the week is ragged.
 */
function evenSplit(hoursPerWeek, daysPerWeek) {
  return Array(daysPerWeek).fill(hoursPerWeek / daysPerWeek);
}

/* Inverse: max hours affordable at a given weekly budget.
 * Answers "I can spend $1,200/week — how many hours is that?"
 * Solved by bisection so it works for every ruleset without algebra per state.
 */
function hoursForBudget(rate, budget, daysPerWeek, stateKey, maxHoursPerDay = 16) {
  const ceiling = daysPerWeek * maxHoursPerDay;
  /* `capped` must mean exactly one thing — "hit the per-day ceiling" — so the
     degenerate zero-ceiling case reports false rather than a nonsense true. */
  if (ceiling <= 0) return { hours: 0, capped: false };
  if (computeWeek(rate, evenSplit(ceiling, daysPerWeek), stateKey).cost <= budget) {
    return { hours: ceiling, capped: true };
  }
  let lo = 0, hi = ceiling;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const c = computeWeek(rate, evenSplit(mid, daysPerWeek), stateKey).cost;
    if (c > budget) hi = mid; else lo = mid;
  }
  return { hours: round2(lo), capped: false };
}

/* Base rate that produces a target average (base + overtime) hourly rate.
 *
 * Every rule in this engine scales linearly with the base rate - reg, OT and
 * DT are all multiples of it - so cost(r) === r * cost(1). That makes this an
 * exact division, not a search: price one week at $1/hr, and the rate you need
 * is target * hours / that. Mike was hand-tuning the rate box to land on a
 * blended number; this is the same answer in one step.
 *
 * Returns 0 on nonsense input rather than NaN, so a half-typed field renders
 * as a dash instead of "$NaN".
 */
function rateForBlended(targetBlended, hoursPerWeek, daysPerWeek, stateKey) {
  const h = Number(hoursPerWeek) || 0;
  const t = Number(targetBlended) || 0;
  if (h <= 0 || t <= 0) return 0;
  const unit = computeWeek(1, evenSplit(h, daysPerWeek), stateKey).cost;
  if (!(unit > 0)) return 0;
  return round2(t * h / unit);
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

if (typeof module !== 'undefined') {
  module.exports = { RULES, WORKWEEK_START, computeWeek, evenSplit, hoursForBudget, rateForBlended, round2 };
}
