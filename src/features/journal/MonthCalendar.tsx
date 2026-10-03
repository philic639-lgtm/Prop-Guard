import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { dayKey } from '@/utils/dates';

interface MonthCalendarProps {
  month: Date;
  pnlByDay: Map<string, number>;
  selected: string | null;
  onSelect: (day: string | null) => void;
  onMonthChange: (delta: number) => void;
}

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MonthCalendarBase({ month, pnlByDay, selected, onSelect, onMonthChange }: MonthCalendarProps) {
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= days; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);
  const today = dayKey(new Date());
  const title = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <Card>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => onMonthChange(-1)}>
          <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
        </Pressable>
        <AppText variant="heading">{title}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} onPress={() => onMonthChange(1)}>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {WD.map((d, i) => (
          <View key={`${d}${i}`} style={styles.cell}>
            <AppText variant="label" style={{ fontSize: 10 }}>
              {d}
            </AppText>
          </View>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={styles.cell} />;
          const k = dayKey(d);
          const pnl = pnlByDay.get(k);
          const isSel = selected === k;
          const bg = pnl == null ? 'transparent' : pnl > 0 ? colors.positiveMuted : pnl < 0 ? colors.dangerMuted : colors.surface;
          return (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={`${d.toDateString()}${pnl != null ? `, ${pnl >= 0 ? 'profit' : 'loss'} ${Math.abs(Math.round(pnl))} dollars` : ''}`}
              accessibilityState={{ selected: isSel }}
              onPress={() => onSelect(isSel ? null : k)}
              style={styles.cell}>
              <View style={[styles.day, { backgroundColor: bg }, isSel && styles.sel, k === today && styles.today]}>
                <AppText variant="caption" tone={pnl == null ? 'tertiary' : 'primary'} style={{ fontWeight: pnl != null ? '600' : '400' }}>
                  {d.getDate()}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export const MonthCalendar = memo(MonthCalendarBase);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  sel: { borderWidth: 1.5, borderColor: colors.accent },
  today: { borderWidth: 1, borderColor: colors.borderStrong },
});
