import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Sheet, TabSwitch } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { FIELD_LABEL } from '@/lib/engines/accountImport';

import { EXAMPLE_FIRM, GUIDE, type GuideExample, type GuidePage } from './exampleGuide';

/** What traders should hide before taking a screenshot (shown in the guide and on the upload screen). */
export function SensitiveInfoWarning({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.warn} accessibilityRole="alert">
      <View style={styles.row}>
        <Ionicons name="eye-off-outline" size={16} color={colors.warning} />
        <AppText variant="bodyStrong" style={{ color: colors.warning }}>
          Hide private details first
        </AppText>
      </View>
      <AppText variant="caption">
        Crop or cover passwords, API keys, login emails, full names, addresses and payment details before you take the screenshot.
        {compact ? '' : ' Prop Guard never needs them — account numbers it finds are masked and never stored.'}
      </AppText>
    </View>
  );
}

/** Mock-up of one dashboard page with the values to capture numbered and highlighted. */
function MockScreen({ g }: { g: GuideExample }) {
  let n = 0;
  const headerNo = g.header.fields.length ? ++n : null;
  return (
    <View style={styles.frame} accessibilityLabel={`Example ${g.title} screenshot`}>
      <View style={styles.bar}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.dot} />
        ))}
        <View style={styles.flex} />
        <View style={styles.exampleTag}>
          <AppText variant="caption" style={styles.exampleTagText}>
            EXAMPLE
          </AppText>
        </View>
      </View>
      <View style={[styles.header, headerNo != null && styles.hl]}>
        {headerNo != null ? <Badge n={headerNo} /> : null}
        <AppText variant="caption" tone="tertiary">
          {EXAMPLE_FIRM}
        </AppText>
        <AppText variant="bodyStrong">{g.header.title}</AppText>
        <AppText variant="caption" tone="secondary">
          {g.header.subtitle}
        </AppText>
      </View>
      {g.key === 'overview' ? (
        <View style={styles.private}>
          <Ionicons name="eye-off-outline" size={14} color={colors.danger} />
          <AppText variant="caption" style={styles.flex}>
            Login email · name · password
          </AppText>
          <AppText variant="caption" style={{ color: colors.danger }}>
            cover this
          </AppText>
        </View>
      ) : null}
      <View style={styles.grid}>
        {g.tiles.map((t) => {
          const no = t.field ? ++n : null;
          return (
            <View key={t.label} style={[styles.tile, no != null ? styles.hl : styles.dim]}>
              {no != null ? <Badge n={no} /> : null}
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                {t.label}
              </AppText>
              <AppText variant="bodyStrong" style={styles.num}>
                {t.value}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Badge({ n, inline }: { n: number; inline?: boolean }) {
  return (
    <View style={[styles.badge, inline && styles.badgeInline]}>
      <AppText variant="caption" style={styles.badgeText}>
        {n}
      </AppText>
    </View>
  );
}

/** The numbered list under the mock-up: what each highlighted value is. */
function CaptureList({ g }: { g: GuideExample }) {
  const items: { no: number; title: string; hint: string }[] = [];
  let n = 0;
  if (g.header.fields.length) items.push({ no: ++n, title: 'Page title', hint: `${g.header.fields.map((f) => FIELD_LABEL[f]).join(', ')} — e.g. “${g.header.title}”, “${g.header.subtitle}”.` });
  for (const t of g.tiles) if (t.field) items.push({ no: ++n, title: t.label, hint: t.hint ?? FIELD_LABEL[t.field] });
  const skipped = g.tiles.filter((t) => !t.field);
  return (
    <View style={styles.list}>
      <AppText variant="label">Capture these</AppText>
      {items.map((i) => (
        <View key={i.no} style={styles.listRow}>
          <Badge n={i.no} inline />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{i.title}</AppText>
            <AppText variant="caption" tone="secondary">
              {i.hint}
            </AppText>
          </View>
        </View>
      ))}
      {skipped.length ? (
        <AppText variant="caption" tone="tertiary">
          Dimmed values ({skipped.map((t) => t.label).join(', ')}) are not needed. {skipped.map((t) => t.hint).filter(Boolean).join(' ')}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * "See example screenshots": which dashboard pages to capture (overview,
 * drawdown & limits, rules) and which values on each are read. Illustrative
 * mock-ups only — nothing here is ever imported.
 */
export function ExampleScreenshotGuide({ visible, onClose, initial = 'overview' }: { visible: boolean; onClose: () => void; initial?: GuidePage }) {
  // Opens on `initial`; the caller remounts it (key) to open on another page.
  const [page, setPage] = useState<GuidePage>(initial);
  const g = GUIDE.find((x) => x.key === page)!;
  return (
    <Sheet visible={visible} onClose={onClose} title="Example screenshots">
      <AppText variant="caption" tone="secondary">
        Most dashboards spread the details over a few pages. Take one screenshot of each page below that your firm shows — add them all in one import and Prop Guard combines them. You review every value before anything is saved.
      </AppText>
      <TabSwitch
        options={GUIDE.map((x) => ({ value: x.key, label: x.key === 'overview' ? 'Overview' : x.key === 'drawdown' ? 'Drawdown' : 'Rules' }))}
        value={page}
        onChange={setPage}
      />
      <View style={styles.gap}>
        <AppText variant="heading">{g.title}</AppText>
        <AppText variant="caption" tone="secondary">
          {g.where}
        </AppText>
      </View>
      <MockScreen g={g} />
      <CaptureList g={g} />
      <View style={styles.tip}>
        <Ionicons name="bulb-outline" size={16} color={colors.accentBright} />
        <AppText variant="caption" style={styles.flex}>
          {g.tip}
        </AppText>
      </View>
      <SensitiveInfoWarning />
      <AppText variant="caption" tone="tertiary">
        Example firm and numbers for illustration only — not real firm rules.
      </AppText>
      <Button label="Got it" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  warn: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning + '55', backgroundColor: colors.warningMuted },
  frame: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  exampleTag: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.accentMuted },
  exampleTagText: { color: colors.accentBright, fontWeight: '700', letterSpacing: 1 },
  header: { gap: 2, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
  private: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.danger, backgroundColor: colors.dangerMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexBasis: '47%', flexGrow: 1, gap: 2, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  hl: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentMuted },
  dim: { opacity: 0.45 },
  num: { fontVariant: ['tabular-nums'] },
  badge: { position: 'absolute', top: -8, right: -8, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  badgeInline: { position: 'relative', top: 0, right: 0, marginTop: 2 },
  badgeText: { color: colors.accentOn, fontWeight: '700', fontSize: 11 },
  list: { gap: spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingLeft: spacing.xs },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentMuted },
});
