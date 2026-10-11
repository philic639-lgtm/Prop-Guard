import type { FieldKey } from '@/lib/engines/accountImport';

/**
 * "See example screenshots": which dashboard pages to capture and which
 * values on them Prop Guard reads. The mock-ups use a made-up firm and
 * illustrative numbers — they are never real firm rules and never feed an
 * import (the guide only teaches what to capture).
 */
export type GuidePage = 'overview' | 'drawdown' | 'rules';

export interface GuideTile {
  label: string;
  /** Illustrative value shown on the mock-up. */
  value: string;
  /** The import field this label fills — highlighted and numbered when set. */
  field?: FieldKey;
  /** What the value means (shown in the "capture these" list). */
  hint?: string;
}

export interface GuideExample {
  key: GuidePage;
  title: string;
  /** Where traders usually find this page. */
  where: string;
  header: { title: string; subtitle: string; fields: FieldKey[] };
  tiles: GuideTile[];
  tip: string;
}

export const EXAMPLE_FIRM = 'Example Prop Firm';

export const GUIDE: GuideExample[] = [
  {
    key: 'overview',
    title: 'Account Overview',
    where: 'Usually the first page after you open the account (Dashboard / Overview).',
    header: { title: 'Example 50K Evaluation', subtitle: 'Status: Active', fields: ['program', 'accountSize', 'stage', 'status'] },
    tiles: [
      { label: 'Account Balance', value: '$50,640.25', field: 'balance', hint: 'Your balance right now — not the drawdown level.' },
      { label: 'Starting Balance', value: '$50,000.00', field: 'startingBalance', hint: 'The balance the account started with.' },
      { label: 'Net P&L', value: '+$640.25', field: 'netPnl', hint: 'Total profit or loss since the start.' },
      { label: 'Win Rate', value: '54%' },
    ],
    tip: 'Include the page title with the plan name and size (e.g. "50K Evaluation") — it identifies the program.',
  },
  {
    key: 'drawdown',
    title: 'Drawdown & Risk Limits',
    where: 'Often a "Drawdown", "Risk" or "Objectives" panel, sometimes further down the dashboard.',
    header: { title: 'Drawdown & Limits', subtitle: 'Trailing, end of day', fields: [] },
    tiles: [
      { label: 'Max Drawdown', value: '$2,000.00', field: 'maxDrawdown', hint: 'The size of the loss allowance — an amount, not a balance.' },
      { label: 'Drawdown Threshold', value: '$48,640.25', field: 'drawdownThreshold', hint: 'The balance level where the account fails.' },
      { label: 'Drawdown Remaining', value: '$2,000.00', field: 'drawdownRemaining', hint: 'How much more you can lose before the threshold.' },
      { label: 'Daily Loss Limit', value: '$1,000.00', field: 'dailyLossLimit', hint: 'Most you may lose in one day.' },
    ],
    tip: 'Balance, threshold and remaining drawdown are three different numbers — capture all that are shown so Prop Guard can cross-check them.',
  },
  {
    key: 'rules',
    title: 'Account Rules',
    where: 'A "Rules", "Plan details" or "Account details" page.',
    header: { title: 'Plan Details', subtitle: 'Example 50K Evaluation', fields: [] },
    tiles: [
      { label: 'Profit Target', value: '$3,000.00', field: 'profitTarget', hint: 'Profit needed to pass.' },
      { label: 'Purchase Date', value: 'Sep 15, 2026', field: 'startDate', hint: 'Picks the rule version that applies to your account.' },
      { label: 'Daily Loss Limit', value: '$1,000.00', field: 'dailyLossLimit', hint: 'Also read here if the risk panel does not show it.' },
      { label: 'Max Contracts', value: '5', hint: 'Not read from screenshots — set it on the account.' },
    ],
    tip: 'Verified program rules always come from Prop Guard’s rules database; screenshot rule values are only offered when no verified version applies.',
  },
];

/** Fields the guide asks for, in capture order (for the "still missing" summary on the review screen). */
export const GUIDE_FIELDS: { field: FieldKey; page: GuidePage }[] = GUIDE.flatMap((g) => [
  ...g.header.fields.map((field) => ({ field, page: g.key })),
  ...g.tiles.filter((t) => t.field).map((t) => ({ field: t.field!, page: g.key })),
]).filter((x, i, all) => all.findIndex((y) => y.field === x.field) === i);

/** The guide page that shows where a field usually is. */
export const guidePageFor = (field: FieldKey): GuideExample | undefined => GUIDE.find((g) => g.key === GUIDE_FIELDS.find((x) => x.field === field)?.page);
