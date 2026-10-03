import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { InstrumentSpec } from '@/data/instruments';
import { specSummary } from '@/lib/engines/instrumentEngine';

interface Props {
  spec: InstrumentSpec;
  selected: boolean;
  onToggle: (symbol: string) => void;
}

/** Selectable contract row: ticker, name, micro tag and contract math. */
function InstrumentRowBase({ spec, selected, onToggle }: Props) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${spec.symbol}, ${spec.name}${spec.isMicro ? ', micro' : ''}`}
      onPress={() => onToggle(spec.symbol)}
      style={({ pressed }) => [styles.row, selected && styles.on, pressed && { opacity: 0.85 }]}>
      <View style={[styles.ticker, selected && styles.tickerOn]}>
        <AppText variant="bodyStrong" style={{ color: selected ? colors.text : colors.accentBright, fontSize: 13 }} numberOfLines={1} adjustsFontSizeToFit>
          {spec.symbol}
        </AppText>
      </View>
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {spec.name}
          </AppText>
          {spec.isMicro ? (
            <View style={styles.tag}>
              <AppText variant="label" style={{ fontSize: 9, color: colors.accentBright }}>
                Micro
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" tone="tertiary" numberOfLines={1}>
          {specSummary(spec.symbol)}
        </AppText>
      </View>
      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.accentBright : colors.textTertiary} />
    </Pressable>
  );
}

export const InstrumentRow = memo(InstrumentRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  on: { borderColor: colors.accent, backgroundColor: '#0D1B33' },
  ticker: { width: 52, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentMuted, paddingHorizontal: 4 },
  tickerOn: { backgroundColor: colors.accent },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flexShrink: 1 },
  tag: { backgroundColor: colors.accentMuted, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
});
