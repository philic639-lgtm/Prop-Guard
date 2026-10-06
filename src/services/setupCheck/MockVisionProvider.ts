import type { VisionRequest } from '@/lib/engines/setupValidation';

import type { VisionAnalysisProvider, VisionImage, VisionResponse } from './VisionAnalysisProvider';

/** Small deterministic hash so the same screenshot + rule gives the same demo answer. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * DEVELOPMENT / DEMO provider — it does NOT read the chart. Results are
 * simulated (deterministic per screenshot) so the UI and the decision engine
 * can be exercised without AI credentials. Every result is labelled DEMO and
 * this provider is never used in a production build with AI configured.
 */
export class MockVisionProvider implements VisionAnalysisProvider {
  readonly id = 'mock' as const;

  async analyze(image: VisionImage, request: VisionRequest): Promise<VisionResponse> {
    const seed = `${image.base64.length}:${image.base64.slice(-64)}`;
    const criteria = request.criteria.map((c, i) => {
      const r = hash(`${seed}:${c.ruleId}`);
      // Mostly confirmed, some still unconfirmed, rarely contradicted — enough to show all three decisions.
      const status = r < 0.7 || i === 0 ? 'PASS' : r < 0.93 ? 'UNVERIFIED' : 'FAIL';
      const evidence =
        status === 'PASS'
          ? 'Simulated: treated as visible on the chart.'
          : status === 'UNVERIFIED'
            ? 'Simulated: not clearly visible — would need a clearer or later screenshot.'
            : 'Simulated: chart treated as contradicting this rule.';
      return { ruleId: c.ruleId, ruleName: c.ruleName, status, evidence, confidence: status === 'PASS' ? 0.8 : 0.6 };
    });
    return {
      provider: 'mock',
      model: null,
      raw: {
        chart: { instrument: request.instrument || null, timeframe: request.timeframe, directionObserved: null, marketCondition: null },
        criteria,
        riskEvidence: { entry: null, stop: null, target: null, pricesConfidence: 0 },
        imageQuality: { score: 75, issues: ['DEMO analysis — the chart was not actually read. Configure AI to analyse real screenshots.'] },
        summary: 'DEMO — simulated analysis for testing the Setup Check flow. Not a reading of your chart.',
      },
    };
  }
}
