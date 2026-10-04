import type { StructuredStrategy } from '@/lib/engines/strategyIntelligence';

/**
 * Historical Practice has scenarios only for strategies with shared rule
 * evaluators. Map an analysed strategy to the template whose scenarios match
 * its STRUCTURE — or null when none does (never pretend a different strategy is the same).
 */
export function practiceTemplateFor(s: StructuredStrategy): { templateId: string; exact: boolean } | null {
  // Prefer the trader's OWN compiled rules (see analysis screen); templates are only for exact structural matches.
  const ids = new Set(s.detectedStyle.map((x) => x.id));
  if (ids.has('orb')) {
    const mins = /(\d+)\s*-?\s*(?:min(?:ute)?s?|m)\s*-?\s*(?:ORB|opening range)/i.exec(s.originalText)?.[1];
    const id = mins === '5' || mins === '15' || mins === '30' ? `orb-${mins}` : 'orb-15';
    return { templateId: id, exact: !!mins && ['5', '15', '30'].includes(mins) };
  }
  const breakout = ids.has('breakout') || ids.has('retest');
  if (ids.has('pdh_pdl') && breakout && !ids.has('liquidity_sweep')) {
    return { templateId: /low|PDL/i.test(s.originalText) && s.direction !== 'long' ? 'pdl-breakdown' : 'pdh-breakout', exact: true };
  }
  if (ids.has('vwap') && (ids.has('reversal') || /reclaim/i.test(s.originalText)) && !ids.has('mean_reversion')) return { templateId: 'vwap-reclaim', exact: true };
  return null;
}
