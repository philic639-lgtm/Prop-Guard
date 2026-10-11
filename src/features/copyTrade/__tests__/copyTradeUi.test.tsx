/**
 * Render tests for the new Copy Trade surfaces and visual components
 * (dashboard card, review card, empty states, illustrations, brand mark).
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { BrandMark, EmptyState, Illustration, Logo, type IllustrationKind } from '@/components/ui';
import { DEFAULT_COPY_SETTINGS, translateCopyTrade } from '@/lib/engines/copyTradeEngine';
import { computeDailyGuard } from '@/lib/engines/dailyGuardEngine';
import { useAppStore } from '@/store/useAppStore';
import { makeAccount, makeRules } from '@/test/fixtures';

import { TAB_ITEMS } from '@/components/domain/TabBar';
import { newCopyGroup } from '@/lib/engines/accountCopierEngine';

import { AccountCopierPanel } from '../AccountCopierPanel';
import { CopyVerdictCard } from '../CopyVerdictCard';

// Icon fonts load asynchronously; a static stand-in keeps renders synchronous.
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => `icon:${name}` }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());
const mounted: ReactTestRenderer[] = [];
function render(el: React.ReactElement) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(el);
  });
  mounted.push(r);
  return r;
}
// Unmount so live clocks (useNow) stop after each test.
afterEach(() => act(() => mounted.splice(0).forEach((r) => r.unmount())));

describe('Copy Trade UI', () => {
  beforeEach(() => useAppStore.getState().startFresh('local'));

  it('14: the five primary destinations, in order, with labels', () => {
    expect(Object.values(TAB_ITEMS).map((t) => t.label)).toEqual(['Home', 'Strategies', 'Copy Trade', 'Journal', 'More']);
  });

  it('trade copier: needs two accounts; setup-only banner; live start disabled with the reason', () => {
    expect(text(render(<AccountCopierPanel />))).toContain('Link two or more accounts');
    act(() => {
      useAppStore.getState().upsertAccount(makeAccount({ id: 'm', name: 'Master 50K' }));
      useAppStore.getState().upsertAccount(makeAccount({ id: 'f', name: 'Follower 25K' }));
      useAppStore.getState().upsertCopyGroup({ ...newCopyGroup('g1', '2026-10-12T00:00:00Z'), masterAccountId: 'm', followers: [{ accountId: 'f', multiplier: 0.5, maxContracts: 2, dailyLossLimit: 300, enabled: true }] });
    });
    const t = text(render(<AccountCopierPanel />));
    expect(t).toContain('Setup & preview only');
    expect(t).toContain('Start live copying');
    expect(t).toContain('Live copying needs a connected, supported broker');
    expect(t).toContain('Not connected');
    expect(t).toContain('Follower 25K');
  });

  it('review card shows verdict, size, risk and the reduced-size suggestion', () => {
    const account = makeAccount({ rules: { dailyLossLimit: 1_000, maxDrawdown: 2_000, drawdownType: 'trailing', maxContracts: 10 } as never });
    const rules = makeRules({ maxRiskPerTrade: 300, dailyStop: 600 });
    const now = new Date('2026-10-12T14:30:00Z');
    const tr = translateCopyTrade(
      { instrument: 'MNQ', direction: 'long', entry: 20_000, stop: 19_980, target: null, sourceContracts: 10, sourceInstrument: 'MNQ', conviction: null },
      { account, rules, guard: computeDailyGuard({ account, rules, trades: [], now }), settings: { ...DEFAULT_COPY_SETTINGS, sizingMode: 'mirror', requireManualConfirm: false, blockNearLimit: false }, copiedToday: 0, now, timeZone: 'America/New_York' },
    );
    const t = text(render(<CopyVerdictCard t={tr} sourceLine="from Alpha" />));
    expect(t).toContain('Reduce size');
    expect(t).toContain('7 MNQ');
    expect(t).toContain('Reduce from 10 MNQ to 7 MNQ');
  });

  it('15/17: empty states and every illustration render (SVG only, no image assets to load)', () => {
    const kinds: IllustrationKind[] = ['shield', 'copy', 'chart', 'journal', 'upload', 'strategy', 'trades'];
    for (const k of kinds) expect(render(<Illustration kind={k} />).toJSON()).toBeTruthy();
    const t = text(render(<EmptyState illustration="copy" title="No copies logged yet" message="Log one." actionLabel="Log Copy Trade" onAction={() => {}} />));
    expect(t).toContain('No copies logged yet');
    expect(render(<BrandMark />).toJSON()).toBeTruthy();
    expect(text(render(<Logo tagline />))).toContain('PLAN YOUR TRADE.');
  });
});
