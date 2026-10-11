import type { Account } from '@/types/domain';

/**
 * The account's prop-firm news-trading rule — ONLY from the verified firm-rules snapshot
 * saved with the account (`firmLink.snapshot`, record key `news`). Unverified, missing or
 * custom firms say so; Prop Guard never fills in a firm's news policy.
 * (Client only — not part of the server sync.)
 */
export type FirmNewsRule =
  | { status: 'verified'; firmName: string; programName: string; text: string; sources: { url: string; title?: string }[]; checkedAt: string }
  | { status: 'needs_review'; firmName: string; text: string }
  | { status: 'none'; reason: string };

export function firmNewsRule(account: Account | null | undefined): FirmNewsRule {
  if (!account) return { status: 'none', reason: 'No account selected.' };
  if (account.kind !== 'prop') return { status: 'none', reason: 'Personal account — no prop-firm news rule applies.' };
  const snap = account.firmLink?.snapshot;
  const rec = snap?.rules.find((r) => r.key === 'news');
  if (!snap || !rec) return { status: 'none', reason: `No verified news-trading rule on file for ${account.firm || 'this firm'} — check your firm’s rules before trading releases.` };
  if (rec.status !== 'verified') return { status: 'needs_review', firmName: snap.firmName, text: rec.value };
  return { status: 'verified', firmName: snap.firmName, programName: snap.programName, text: rec.value, sources: rec.sources.map((s) => ({ url: s.url, title: s.title })), checkedAt: rec.checkedAt };
}
