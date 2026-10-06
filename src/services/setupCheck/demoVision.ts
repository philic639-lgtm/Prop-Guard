import type { Evidence, SetupRule } from '@/lib/engines/setupCheck';

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
