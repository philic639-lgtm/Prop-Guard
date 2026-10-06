// Prop Guard Setup Check — deterministic engine (supplied implementation).
// SHARED: runs on device (demo / local mode) and in the `setup-validation`
// Edge Function (synced copy in supabase/functions/_shared/setupCheck).
// Keep this file dependency-free.
//
// Adaptations to the supplied engine (documented):
//  - Source adds 'system' for facts computed by Prop Guard itself (instrument
//    allowed, entry window) — never accepted from a client.
//  - Trade.side may be missing (trader chose "unsure"): direction stays
//    UNVERIFIED instead of being assumed.
//  - Trade.tickSize (from the instrument catalog): prices that are not on a
//    valid tick increment stay UNVERIFIED.
export type Status = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type Source = 'manual' | 'vision' | 'broker' | 'demo' | 'system';
export type Rule = { id: string; label: string; required: boolean; critical: boolean };
export type Evidence = { ruleId: string; status: Status; source: Source; confidence: number; reason: string };
export type Trade = {
  side?: 'LONG' | 'SHORT'; entry?: number; stop?: number; target?: number;
  quantity?: number; pointValue?: number; tickSize?: number; costs?: number; slippage?: number;
  minimumRR?: number; maxRisk?: number;
};
// Buffer means CURRENT distance to liquidation threshold, not starting account size.
// The caller must compute it using the firm's current trailing/static rules.
export type Prop = {
  mode: 'none' | 'prop'; verified?: boolean; rulesCurrent?: boolean;
  drawdownBuffer?: number; dailyLossRemaining?: number; maxContracts?: number;
  reserve?: number; otherChecks?: Evidence[];
};
export type AnalysisMode = 'REAL' | 'DEMO' | 'UNAVAILABLE';
export type Input = { rules: Rule[]; evidence: Evidence[]; trade: Trade; prop: Prop; analysisMode: AnalysisMode };
export type Check = { id: string; label: string; status: Status; reason: string };
export type Decision = 'TAKE TRADE' | 'WAIT' | 'STAND DOWN';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const validEvidence = (e: Evidence) => ['PASS','FAIL','UNVERIFIED'].includes(e.status)
  && ['manual','vision','broker','demo','system'].includes(e.source)
  && finite(e.confidence) && e.confidence >= 0 && e.confidence <= 1
  && typeof e.reason === 'string' && e.reason.trim().length > 0;
const aggregate = (checks: Check[]): Status => checks.some(c => c.status === 'FAIL') ? 'FAIL'
  : checks.some(c => c.status === 'UNVERIFIED') || !checks.length ? 'UNVERIFIED' : 'PASS';
/** Price is a whole number of ticks (tolerant to floating-point noise). */
const onTick = (price: number, tick: number) => Math.abs(price / tick - Math.round(price / tick)) < 1e-6;

export function evaluateSetup(input: Input) {
  // Saved strategy is authoritative; AI may not add, delete or waive rules.
  const ids = input.rules.map(r => r.id);
  const definitionValid = ids.every(id => typeof id === 'string' && id.length > 0)
    && new Set(ids).size === ids.length;
  const evaluatedRules = input.rules.map(rule => {
    const matches = input.evidence.filter(e => e.ruleId === rule.id);
    const e = matches.length === 1 ? matches[0] : undefined;
    const usable = e && validEvidence(e) && e.source !== 'demo'
      && (e.source !== 'vision' || (input.analysisMode === 'REAL' && e.confidence >= 0.8));
    return { ...rule, status: usable ? e.status : 'UNVERIFIED' as Status,
      confidence: usable && e.status !== 'UNVERIFIED' ? e.confidence : 0,
      source: e ? e.source : null,
      reason: usable ? e.reason : 'Confirm this rule with real evidence; missing, ambiguous, low-confidence or demo evidence cannot pass.' };
  });
  const required = evaluatedRules.filter(r => r.required || r.critical);
  const passed = required.filter(r => r.status === 'PASS').length;
  const ruleAlignmentScore = required.length ? Math.floor(passed / required.length * 100) : 0;
  const evidenceConfidence = required.length
    ? Math.floor(required.reduce((n,r) => n + r.confidence, 0) / required.length * 100) : 0;
  const riskChecks: Check[] = [];
  const addRisk = (id: string, label: string, status: Status, reason: string) => riskChecks.push({id,label,status,reason});
  const t = input.trade;
  const pricesPresent = [t.entry,t.stop,t.target].every(positive);
  const sizingPresent = positive(t.quantity) && Number.isInteger(t.quantity) && positive(t.pointValue);
  const settingsPresent = positive(t.minimumRR) && positive(t.maxRisk)
    && finite(t.costs) && t.costs >= 0 && finite(t.slippage) && t.slippage >= 0;
  addRisk('prices','Entry / stop / target', pricesPresent ? 'PASS' : 'UNVERIFIED', pricesPresent ? 'All prices supplied.' : 'Enter valid entry, stop and target prices.');
  addRisk('size','Position size', sizingPresent ? 'PASS' : 'UNVERIFIED', sizingPresent ? 'Contract quantity and point value supplied.' : 'Confirm integer contract quantity and instrument dollar value per point.');
  addRisk('settings','Risk limits / execution costs',settingsPresent ? 'PASS' : 'UNVERIFIED', settingsPresent ? 'Limits and costs supplied.' : 'Confirm minimum R:R, maximum risk, estimated fees and dollar slippage (explicit zero allowed).');
  let dollarRisk: number | null = null;
  let reward: number | null = null;
  let rr: number | null = null;
  if (pricesPresent && positive(t.tickSize) && ![t.entry!, t.stop!, t.target!].every(p => onTick(p, t.tickSize!)))
    addRisk('ticks','Tick increments','UNVERIFIED',`Prices must be whole ticks of ${t.tickSize} for this instrument.`);
  if (pricesPresent) {
    if (!t.side) addRisk('direction','Price direction','UNVERIFIED','Choose long or short to check the stop and target sides.');
    const directionValid = t.side === 'LONG' ? t.stop! < t.entry! && t.target! > t.entry!
      : t.side === 'SHORT' && t.stop! > t.entry! && t.target! < t.entry!;
    if (t.side) addRisk('direction','Price direction',directionValid ? 'PASS' : 'FAIL',directionValid ? 'Stop and target match trade direction.' : 'Stop or target is on the wrong side of entry.');
    if (directionValid && sizingPresent && settingsPresent) {
      dollarRisk = Math.abs(t.entry! - t.stop!) * t.quantity! * t.pointValue! + t.costs! + t.slippage!;
      reward = Math.abs(t.target! - t.entry!) * t.quantity! * t.pointValue! - t.costs! - t.slippage!;
      if (![dollarRisk,reward].every(finite)) {
        dollarRisk = reward = null;
        addRisk('numeric','Risk calculation','UNVERIFIED','Risk values overflow; correct the supplied values.');
      } else {
        rr = reward / dollarRisk;
        addRisk('rr','Reward / risk',rr >= t.minimumRR! ? 'PASS' : 'FAIL', `Net R:R ${rr.toFixed(2)}; minimum ${t.minimumRR}.`);
        addRisk('budget','Risk budget',dollarRisk <= t.maxRisk! ? 'PASS' : 'FAIL', `Estimated risk $${dollarRisk.toFixed(2)}; limit $${t.maxRisk}.`);
      }
    }
  }
  const propChecks: Check[] = [];
  const addProp = (id: string,label: string,status: Status,reason: string) => propChecks.push({id,label,status,reason});
  const p = input.prop;
  if (p.mode !== 'none') {
    addProp('verified','Current prop rules',p.verified && p.rulesCurrent ? 'PASS' : 'UNVERIFIED', p.verified && p.rulesCurrent ? 'Current account rules confirmed.' : 'Verify current rules for this exact firm, account plan and stage.');
    const buffersKnown = finite(p.drawdownBuffer) && finite(p.dailyLossRemaining) && finite(p.reserve) && p.reserve >= 0;
    if (!buffersKnown) addProp('buffers','Account buffers','UNVERIFIED','Confirm live drawdown buffer, daily loss remaining and reserve.');
    else if (p.drawdownBuffer! <= p.reserve! || p.dailyLossRemaining! <= p.reserve!)
      addProp('buffers','Account buffers','FAIL','Account is at or beyond a risk threshold or reserved buffer.');
    else if (dollarRisk === null) addProp('buffers','Account buffers','UNVERIFIED','Calculate trade risk before checking account buffers.');
    else addProp('buffers','Account buffers', dollarRisk < p.drawdownBuffer! - p.reserve! && dollarRisk < p.dailyLossRemaining! - p.reserve! ? 'PASS' : 'FAIL','Trade risk must stay strictly below both remaining buffers after reserve.');
    addProp('contracts','Contract limit',positive(p.maxContracts) && Number.isInteger(p.maxContracts) && sizingPresent
      ? t.quantity! <= p.maxContracts! ? 'PASS' : 'FAIL' : 'UNVERIFIED','Confirm position fits the account contract limit; normalize micro/mini limits upstream.');
    if (!p.otherChecks?.length) addProp('other','Other applicable firm rules','UNVERIFIED','Confirm other applicable restrictions (session, news, instruments, scaling, consistency, etc.), or explicitly record that none apply.');
    else {
      const otherIds = p.otherChecks.map(e => e.ruleId);
      if (new Set(otherIds).size !== otherIds.length) addProp('duplicates','Firm evidence','UNVERIFIED','Resolve duplicate firm checks.');
      for (const e of p.otherChecks) addProp(`firm:${e.ruleId}`,e.ruleId,
        validEvidence(e) && (e.source === 'manual' || e.source === 'broker') ? e.status : 'UNVERIFIED',e.reason || 'Confirm this firm rule.');
    }
  }
  const riskCheck = aggregate(riskChecks);
  const propFirmCompliance = p.mode === 'none' ? 'NOT_APPLICABLE' : aggregate(propChecks);
  const blockers: Check[] = [
    ...required.filter(r => r.status !== 'PASS').map(r => ({id:`rule:${r.id}`,label:r.label,status:r.status,reason:r.reason})),
    ...riskChecks.filter(c => c.status !== 'PASS'), ...propChecks.filter(c => c.status !== 'PASS')
  ];
  if (!definitionValid || !required.length) blockers.push({id:'strategy',label:'Strategy definition',status:'UNVERIFIED',reason:'Load a saved strategy with unique rule IDs and at least one required rule.'});
  if (input.analysisMode === 'DEMO') blockers.push({id:'demo',label:'Demo analysis',status:'UNVERIFIED',reason:'Run real chart analysis or switch to manual checking; demo results cannot authorize a trade.'});
  const failed = required.some(r => r.critical && r.status === 'FAIL') || riskCheck === 'FAIL' || propFirmCompliance === 'FAIL';
  const decision: Decision = failed ? 'STAND DOWN' : blockers.length ? 'WAIT' : 'TAKE TRADE';
  return { ruleAlignmentScore, evidenceConfidence, riskCheck, propFirmCompliance, decision,
    passedRequired:passed, totalRequired:required.length, evaluatedRules, riskChecks, propChecks,
    dollarRisk, reward, rr, blockers, analysisMode:input.analysisMode,
    alignmentLabel:decision === 'TAKE TRADE' ? 'Required rules confirmed' : 'Setup incomplete or blocked' };
}

export type SetupEvaluation = ReturnType<typeof evaluateSetup>;
