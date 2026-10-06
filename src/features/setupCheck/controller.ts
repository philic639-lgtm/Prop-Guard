import {
  analysisKey,
  runSetupCheck,
  type AnalysisMode,
  type IccManual,
  type IccObservation,
  type IccSummary,
  type ClientSetupInput,
  type Evidence,
  type SetupEvaluation,
  type SetupRule,
  type Status,
  type StrategyRecord,
  type TrustedContext,
} from '@/lib/engines/setupCheck';
import type { RemoteSetupClient, RemoteSetupResult } from '@/services/setupCheck/remoteSetupCheck';
import { SetupCheckError } from '@/services/setupCheck/errors';

/**
 * Setup Check session state — no React, so it can be tested directly.
 *
 * - REMOTE: the server loads strategy / account / risk data, runs chart
 *   analysis and computes the decision; this device only displays it.
 * - DEMO:   demo mode — evaluated on the device; chart observations are
 *   simulated, labelled, and never count.
 * - MANUAL: no chart analysis available — evaluated on the device from the
 *   trader's explicit confirmations only.
 *
 * Evidence is tied to the exact screenshot, saved-strategy version and
 * inputs: any change invalidates the old analysis, and late responses from
 * older requests are discarded instead of overwriting newer results.
 */
export type ProviderMode = 'REMOTE' | 'DEMO' | 'MANUAL';

export interface SetupForm {
  strategyId: string | null;
  accountId: string | null;
  instrument: string;
  side: 'LONG' | 'SHORT' | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** ICC TP2 (optional; reported as R:R only). */
  target2: number | null;
  quantity: number | null;
  costs: number | null;
  slippage: number | null;
  reserve: number | null;
  noDailyLimitConfirmed: boolean;
  timeframe: string | null;
  notes: string;
}

export interface Screenshot {
  base64: string;
  mimeType: string;
  uri: string | null;
  hash: string;
  sample?: boolean;
}

export interface AnalysisState {
  key: string;
  mode: AnalysisMode;
  evidence: Evidence[];
  analysisId: number | null;
  at: string;
  /** DEMO only: simulated ICC stage reading (shown, never counted). */
  icc?: IccObservation | null;
}

export interface SetupCheckView {
  rules: SetupRule[];
  evaluation: SetupEvaluation | null;
  analysisMode: AnalysisMode;
  evaluatedBy: 'server' | 'device' | null;
  /** True while the shown server result is older than the current inputs. */
  pending: boolean;
  analysis: AnalysisState | null;
  /** Chart evidence per rule (only when fresh). */
  chartEvidence: Record<string, Evidence>;
  key: string | null;
  /** ICC strategies: the ICC SETUP card (null for other strategies). */
  icc: IccSummary | null;
}

export interface ControllerDeps {
  mode: ProviderMode;
  strategy: (id: string | null) => StrategyRecord | null;
  /** Device-side trusted context (DEMO / MANUAL only). */
  trusted: (form: SetupForm, record: StrategyRecord, now: Date) => Omit<TrustedContext, 'visionEvidence' | 'analysisMode' | 'iccObservation'>;
  demoVision: (rules: SetupRule[], imageHash: string) => Evidence[];
  /** DEMO only: simulated ICC stage reading for ICC strategies. */
  demoIcc?: (imageHash: string, side: 'LONG' | 'SHORT' | null) => IccObservation;
  remote: RemoteSetupClient | null;
  now: () => Date;
}

export interface ControllerState {
  form: SetupForm;
  screenshot: Screenshot | null;
  manual: Record<string, Status>;
  firm: Record<string, Status>;
  /** ICC stage confirmations by the trader (nothing pre-selected). */
  icc: IccManual;
  analysis: AnalysisState | null;
  analyzing: boolean;
  analysisError: SetupCheckError | null;
  /** Latest server evaluation and the request key it answers. */
  server: { requestKey: string; result: RemoteSetupResult } | null;
  evaluating: boolean;
  evaluationError: SetupCheckError | null;
}

const RESET_EVIDENCE_FIELDS: (keyof SetupForm)[] = ['strategyId', 'accountId', 'instrument'];

export class SetupCheckController {
  private state: ControllerState;
  private listeners = new Set<() => void>();
  private analyzeSeq = 0;
  private evaluateSeq = 0;
  private cachedView: SetupCheckView | null = null;
  private snapshot: { state: ControllerState; view: SetupCheckView } | null = null;

  constructor(
    private deps: ControllerDeps,
    form: SetupForm,
  ) {
    this.state = { form, screenshot: null, manual: {}, firm: {}, icc: {}, analysis: null, analyzing: false, analysisError: null, server: null, evaluating: false, evaluationError: null };
  }

  // ───────────── subscription (useSyncExternalStore) ─────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  /** Immutable state + view pair for useSyncExternalStore (a new object only after a change). */
  getSnapshot = () => (this.snapshot ??= { state: this.state, view: this.view() });
  private set(patch: Partial<ControllerState>) {
    this.state = { ...this.state, ...patch };
    this.cachedView = null;
    this.snapshot = null;
    this.listeners.forEach((l) => l());
  }
  setDeps(deps: ControllerDeps) {
    this.deps = deps;
    this.cachedView = null;
    this.snapshot = null;
    this.listeners.forEach((l) => l());
  }

  // ───────────── keys ─────────────
  private record() {
    return this.deps.strategy(this.state.form.strategyId);
  }
  /** Key of the evidence-relevant inputs (screenshot, strategy version, instrument, account, prices, size). */
  currentKey(): string | null {
    const r = this.record();
    const f = this.state.form;
    if (!r) return null;
    return analysisKey({ imageHash: this.state.screenshot?.hash ?? null, strategyId: r.id, strategyVersion: r.updatedAt, instrument: f.instrument, accountId: f.accountId, side: f.side, entry: f.entry, stop: f.stop, target: f.target, quantity: f.quantity });
  }
  /** Everything the evaluation depends on (adds costs, confirmations…). */
  private requestKey(): string | null {
    const k = this.currentKey();
    return k == null ? null : JSON.stringify([k, this.clientInput(), this.state.analysis?.analysisId ?? null]);
  }

  // ───────────── edits ─────────────
  setForm(patch: Partial<SetupForm>) {
    const before = this.state.form;
    const form = { ...before, ...patch };
    const resetEvidence = RESET_EVIDENCE_FIELDS.some((f) => f in patch && patch[f] !== before[f]);
    this.state = { ...this.state, form };
    this.set({ ...(resetEvidence ? { manual: {}, firm: {}, icc: {} } : {}), ...this.invalidateIfStale() });
  }

  setScreenshot(s: Screenshot | null) {
    const changed = (s?.hash ?? null) !== (this.state.screenshot?.hash ?? null);
    this.state = { ...this.state, screenshot: s };
    // A different screenshot invalidates the analysis and the trader's chart confirmations.
    this.set({ ...(changed ? { manual: {}, icc: {}, analysisError: null } : {}), ...this.invalidateIfStale() });
  }

  setManual(ruleId: string, status: Status | null) {
    const manual = { ...this.state.manual };
    if (status) manual[ruleId] = status;
    else delete manual[ruleId];
    this.set({ manual });
  }

  /** Set (or clear with null) one ICC stage confirmation. */
  setIcc<K extends keyof IccManual>(key: K, value: IccManual[K] | null) {
    const icc = { ...this.state.icc };
    if (value) icc[key] = value;
    else delete icc[key];
    this.set({ icc });
  }

  setFirm(id: string, status: Status | null) {
    const firm = { ...this.state.firm };
    if (status) firm[id] = status;
    else delete firm[id];
    this.set({ firm });
  }

  private invalidateIfStale(): Partial<ControllerState> {
    const a = this.state.analysis;
    return a && a.key !== this.currentKey() ? { analysis: null } : {};
  }

  // ───────────── inputs ─────────────
  clientInput(): ClientSetupInput {
    const f = this.state.form;
    return {
      strategyId: f.strategyId ?? '',
      accountId: f.accountId,
      instrument: f.instrument,
      side: f.side,
      entry: f.entry,
      stop: f.stop,
      target: f.target,
      target2: f.target2,
      quantity: f.quantity,
      costs: f.costs,
      slippage: f.slippage,
      reserve: f.reserve,
      noDailyLimitConfirmed: f.noDailyLimitConfirmed,
      timeframe: f.timeframe,
      notes: f.notes,
      manual: Object.entries(this.state.manual).map(([ruleId, status]) => ({ ruleId, status })),
      firmConfirmations: Object.entries(this.state.firm).map(([ruleId, status]) => ({ ruleId, status })),
      icc: { ...this.state.icc },
    };
  }

  // ───────────── chart analysis ─────────────
  async analyze(): Promise<void> {
    const shot = this.state.screenshot;
    const record = this.record();
    if (!record) return this.set({ analysisError: new SetupCheckError('no_strategy') });
    if (!shot) return this.set({ analysisError: new SetupCheckError('no_screenshot') });
    if (this.deps.mode === 'MANUAL') return;
    const seq = ++this.analyzeSeq;
    const key = this.currentKey()!;
    this.set({ analyzing: true, analysisError: null });
    try {
      if (this.deps.mode === 'DEMO') {
        const rules = this.deps.trusted(this.state.form, record, this.deps.now()).rules;
        const evidence = this.deps.demoVision(rules, shot.hash);
        const icc = rules.some((r) => r.kind === 'icc') && this.deps.demoIcc ? this.deps.demoIcc(shot.hash, this.state.form.side) : null;
        if (seq !== this.analyzeSeq || key !== this.currentKey()) return; // stale
        this.set({ analysis: { key, mode: 'DEMO', evidence, analysisId: null, at: this.deps.now().toISOString(), icc }, analyzing: false });
        return;
      }
      const remote = this.deps.remote!;
      const requestKey = this.requestKey()!;
      const result = await remote.analyze({ input: this.clientInput(), image: { base64: shot.base64, mimeType: shot.mimeType }, imageHash: shot.hash });
      // Inputs changed or a newer request started while this one ran: discard.
      if (seq !== this.analyzeSeq || key !== this.currentKey()) return;
      this.evaluateSeq++; // supersede any in-flight evaluate
      this.set({
        analysis: { key, mode: result.analysisMode, evidence: [], analysisId: result.analysisId, at: result.evaluatedAt },
        server: { requestKey: this.requestKeyWith(result.analysisId) ?? requestKey, result },
        analyzing: false,
        evaluating: false,
      });
    } catch (e) {
      if (seq !== this.analyzeSeq) return;
      this.set({ analyzing: false, analysisError: e instanceof SetupCheckError ? e : new SetupCheckError('unavailable') });
    } finally {
      if (seq === this.analyzeSeq && this.state.analyzing) this.set({ analyzing: false });
    }
  }

  private requestKeyWith(analysisId: number | null): string | null {
    const k = this.currentKey();
    return k == null ? null : JSON.stringify([k, this.clientInput(), analysisId]);
  }

  /** REMOTE: ask the server to (re)evaluate the current inputs. Older responses never overwrite newer ones. */
  async refresh(): Promise<void> {
    if (this.deps.mode !== 'REMOTE' || !this.deps.remote) return;
    const requestKey = this.requestKey();
    if (!requestKey || !this.state.form.strategyId) return;
    if (this.state.server?.requestKey === requestKey) return;
    const seq = ++this.evaluateSeq;
    this.set({ evaluating: true, evaluationError: null });
    try {
      const result = await this.deps.remote.evaluate({ input: this.clientInput(), imageHash: this.state.screenshot?.hash ?? null, analysisId: this.state.analysis?.analysisId ?? null });
      if (seq !== this.evaluateSeq || requestKey !== this.requestKey()) return; // stale
      this.set({ server: { requestKey, result }, evaluating: false });
    } catch (e) {
      if (seq !== this.evaluateSeq) return;
      this.set({ evaluating: false, evaluationError: e instanceof SetupCheckError ? e : new SetupCheckError('unavailable') });
    }
  }

  // ───────────── view ─────────────
  view(): SetupCheckView {
    if (this.cachedView) return this.cachedView;
    const record = this.record();
    const key = this.currentKey();
    const a = this.state.analysis && this.state.analysis.key === key ? this.state.analysis : null;
    let v: SetupCheckView;
    if (!record) {
      v = { rules: [], evaluation: null, analysisMode: 'UNAVAILABLE', evaluatedBy: null, pending: false, analysis: null, chartEvidence: {}, key, icc: null };
    } else if (this.deps.mode === 'REMOTE') {
      const s = this.state.server;
      const fresh = !!s && s.requestKey === this.requestKey();
      const rules = (s?.result.rules ?? this.deps.trusted(this.state.form, record, this.deps.now()).rules) as SetupRule[];
      const chartEvidence: Record<string, Evidence> = {};
      if (s && a && s.result.analysisMode === 'REAL') for (const r of s.result.evaluation.evaluatedRules) if (r.source === 'vision') chartEvidence[r.id] = { ruleId: r.id, status: r.status, source: 'vision', confidence: r.confidence, reason: r.reason };
      v = { rules, evaluation: s?.result.evaluation ?? null, analysisMode: a && s ? s.result.analysisMode : 'UNAVAILABLE', evaluatedBy: s ? 'server' : null, pending: !fresh, analysis: a, chartEvidence, key, icc: s?.result.icc ?? null };
    } else {
      const now = this.deps.now();
      const trusted = this.deps.trusted(this.state.form, record, now);
      // Demo mode is always DEMO (demo data can never clear a setup); manual-only mode has no chart analysis.
      const mode: AnalysisMode = this.deps.mode === 'DEMO' ? 'DEMO' : 'UNAVAILABLE';
      const evidence = a?.evidence ?? [];
      const iccObservation = a?.icc ? { data: a.icc, source: 'demo' as const } : null;
      const { evaluation, icc } = runSetupCheck(this.clientInput(), { ...trusted, visionEvidence: evidence, analysisMode: mode, iccObservation });
      const chartEvidence: Record<string, Evidence> = {};
      for (const e of evidence) chartEvidence[e.ruleId] = e;
      v = { rules: trusted.rules, evaluation, analysisMode: evaluation.analysisMode, evaluatedBy: 'device', pending: false, analysis: a, chartEvidence, key, icc };
    }
    this.cachedView = v;
    return v;
  }
}
