import type { Evidence, IccObservation, SetupRule } from '@/lib/engines/setupCheck';

/**
 * DEMO ONLY — does not read the chart. Produces clearly-labelled simulated
 * observations (source 'demo') so the flow can be explored in demo mode.
 * The engine gives demo evidence ZERO weight and blocks clearance in DEMO mode.
 */
export function demoObservations(rules: SetupRule[], imageHash: string): Evidence[] {
  let h = 2166136261;
  for (let i = 0; i < imageHash.length; i++) h = Math.imul(h ^ imageHash.charCodeAt(i), 16777619);
  return rules
    .filter((r) => r.kind === 'visual')
    .map((r, i) => {
      const x = (((h ^ Math.imul(i + 1, 2654435761)) >>> 0) % 100) / 100;
      const status = x < 0.6 ? 'PASS' : x < 0.9 ? 'UNVERIFIED' : 'FAIL';
      return { ruleId: r.id, status, source: 'demo', confidence: status === 'UNVERIFIED' ? 0 : 0.9, reason: `DEMO — simulated ${status === 'PASS' ? 'match' : status === 'FAIL' ? 'mismatch' : 'missing evidence'}; the chart was not read.` } as Evidence;
    });
}

/**
 * DEMO ONLY — a simulated ICC stage reading so the ICC card and overlay can be
 * explored. It does not read the chart, carries no price levels, and the ICC
 * logic never counts it (only REAL chart analysis or the trader's own stage
 * confirmations count).
 */
export function demoIccObservation(imageHash: string, side: 'LONG' | 'SHORT' | null = null): IccObservation {
  let h = 2166136261;
  for (let i = 0; i < imageHash.length; i++) h = Math.imul(h ^ imageHash.charCodeAt(i), 16777619);
  // Follows the trader's chosen side so the illustration matches their idea; otherwise hash-based.
  const bullish = side ? side === 'LONG' : (h >>> 0) % 2 === 0;
  const dir = bullish ? 'BULLISH' : 'BEARISH';
  const note = 'DEMO — simulated; the chart was not read.';
  return {
    htfBias: dir,
    htfReason: note,
    indication: { status: 'CONFIRMED', direction: dir, swingLevel: null, bodyClose: true, displacement: 'STRONG', reason: note },
    correction: { status: 'CONFIRMED', zoneLow: null, zoneHigh: null, reason: note },
    continuation: { status: 'DEVELOPING', level: null, momentum: null, reason: note },
    roomToTarget: null,
    levels: { entry: null, stop: null, tp1: null, tp2: null },
    overlay: bullish
      ? { tp2: 0.08, tp1: 0.18, continuation: 0.3, entry: 0.4, indication: 0.5, correctionTop: 0.45, correctionBottom: 0.62, stop: 0.72 }
      : { tp2: 0.92, tp1: 0.82, continuation: 0.7, entry: 0.6, indication: 0.5, correctionTop: 0.38, correctionBottom: 0.55, stop: 0.28 },
    nextCondition: '',
    confidence: 0,
  };
}
