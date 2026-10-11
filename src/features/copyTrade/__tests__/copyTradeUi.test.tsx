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

import { CopyTradeHomeCard } from '../CopyTradeHomeCard';
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

  it('13: dashboard card — intro before any trader, summary + Log Copy Trade after', () => {
    expect(text(render(<CopyTradeHomeCard />))).toContain('Follow other traders without oversizing');
    act(() => {
      useAppStore.getState().upsertSourceTrader({ id: 's1', name: 'Alpha', platform: 'discord', assetClass: 'futures', instruments: ['MNQ'], style: null, notes: '', trustRating: null, isActive: true, archived: false, settings: DEFAULT_COPY_SETTINGS, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' });
    });
    const t = text(render(<CopyTradeHomeCard />));
    expect(t).toContain('Active traders');
    expect(t).toContain('Copied today');
    expect(t).toContain('Log Copy Trade');
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
