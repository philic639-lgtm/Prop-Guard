/**
 * "Teach Prop Guard your plan": confirmed answers survive a reload (device storage re-read), and
 * resolving a rule updates the plan screen's views AND the one saved strategy record.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { isDraftStrategy, planOf, planQuestions, planReadiness, planToStrategy, scorePlan, syncedStrategy } from '@/lib/engines/strategyPlan';

import { useAppStore } from '../useAppStore';

jest.mock('@/services/supabase/client', () => ({ supabase: {} }));

const ORB =
  'I draw out the high and low of 9:30 am EST–9:45 candle. Then I wait until 9:50 to start looking for a move. If price is outside the ORB by 9:50–9:55, I follow the direction outside the ORB. If it’s inside the ORB, I take a move following its direction inside the ORB.';

/** Simulated app reload: memory wiped, both stores read back from device storage. */
async function reload() {
  const plan = await AsyncStorage.getItem('propguard-strategy-analysis');
  const app = await AsyncStorage.getItem('prop-guard-store');
  useStrategyAnalysisStore.setState({ text: '', plan: null, analysis: null, savedId: null });
  useAppStore.setState({ strategies: [] });
  await new Promise((r) => setTimeout(r, 0));
  await AsyncStorage.setItem('propguard-strategy-analysis', plan!);
  await AsyncStorage.setItem('prop-guard-store', app!);
  await useStrategyAnalysisStore.persist.rehydrate();
  await useAppStore.persist.rehydrate();
}

/** What the plan screen does after each confirmed change once the plan is saved. */
function syncSaved() {
  const { plan, savedId } = useStrategyAnalysisStore.getState();
  const st = useAppStore.getState();
  const next = syncedStrategy(st.strategies.find((s) => s.id === savedId), plan!, new Date().toISOString());
  if (next) st.upsertStrategy(next);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useAppStore.getState().startFresh('local' as never);
  useStrategyAnalysisStore.getState().reset();
});

it('answers persist through a reload, and resolving a rule updates questions, missing rules, score and the saved strategy', async () => {
  const a = useStrategyAnalysisStore.getState();
  a.submit(ORB);
  a.answerPlan('instrument', { text: 'MNQ' });
  // Save as a draft.
  const first = planToStrategy(useStrategyAnalysisStore.getState().plan!, { id: 'plan-1', now: new Date().toISOString() });
  useAppStore.getState().upsertStrategy(first);
  useStrategyAnalysisStore.getState().setSavedId('plan-1');
  expect(isDraftStrategy(first)).toBe(true);

  await reload();
  let plan = useStrategyAnalysisStore.getState().plan!;
  expect(useStrategyAnalysisStore.getState().savedId).toBe('plan-1');
  expect(plan.fields.instrument).toMatchObject({ value: ['MNQ'], status: 'supplied', source: 'answer' });
  expect(plan.fields.openingRange.value).toEqual({ start: '09:30', end: '09:45', minutes: 15 });
  const before = { q: planQuestions(plan).length, open: planReadiness(plan).unresolved, score: scorePlan(plan).score };

  // Resolve the outside-range direction.
  useStrategyAnalysisStore.getState().answerPlan('branch:b1', { text: 'Trade the side price broke out of' });
  syncSaved();
  plan = useStrategyAnalysisStore.getState().plan!;
  expect(planQuestions(plan).length).toBe(before.q - 1);
  expect(planReadiness(plan).unresolved).not.toContain('Direction outside the range');
  expect(before.open).toContain('Direction outside the range');
  expect(scorePlan(plan).score).toBeGreaterThan(before.score);
  const saved = useAppStore.getState().strategies.filter((s) => s.id === 'plan-1');
  expect(saved).toHaveLength(1);
  expect(planOf(saved[0])!.branches[0]).toMatchObject({ status: 'supplied', directionRule: 'Trade the side price broke out of' });

  await reload();
  const reopened = planOf(useAppStore.getState().strategies.find((s) => s.id === 'plan-1'))!;
  expect(reopened.branches[0].directionRule).toBe('Trade the side price broke out of');
  expect(useStrategyAnalysisStore.getState().plan!.branches[0].status).toBe('supplied');
  expect(scorePlan(reopened).score).toBe(scorePlan(useStrategyAnalysisStore.getState().plan!).score);
});

it('editing the description flags carried answers for review, and the flag survives a reload', async () => {
  const a = useStrategyAnalysisStore.getState();
  a.submit(ORB);
  a.answerPlan('instrument', { text: 'MNQ' });
  useStrategyAnalysisStore.getState().revise(ORB.replace('9:50 to start', '9:52 to start'));
  await reload();
  const plan = useStrategyAnalysisStore.getState().plan!;
  expect(plan.fields.lookStart.value).toBe('09:52');
  expect(plan.fields.instrument).toMatchObject({ value: ['MNQ'], status: 'needs_clarification', review: true });
  useStrategyAnalysisStore.getState().answerPlan('instrument', { keep: true });
  expect(useStrategyAnalysisStore.getState().plan!.fields.instrument.status).toBe('supplied');
});
