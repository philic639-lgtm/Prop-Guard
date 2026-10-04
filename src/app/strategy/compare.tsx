import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Screen, SelectField } from '@/components/ui';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { CATEGORY_LABEL, STRATEGY_LIBRARY, getTemplate, type StrategyTemplate } from '@/data/strategyLibrary';
import { compareTemplates } from '@/lib/engines';

const MAX = 3;
const COL = 168;

/** Compare up to three frameworks on structure only — no win rates or returns. */
export default function CompareStrategies() {
  const params = useLocalSearchParams<{ ids?: string }>();
  const [ids, setIds] = useState<string[]>(() => (params.ids ?? '').split(',').filter((id) => getTemplate(id)).slice(0, MAX));
  const list = ids.map((id) => getTemplate(id)).filter((t): t is StrategyTemplate => !!t);
  const rows = compareTemplates(list);
  const options = STRATEGY_LIBRARY.filter((t) => !ids.includes(t.id)).map((t) => ({ value: t.id, label: t.shortName, sub: CATEGORY_LABEL[t.category] }));

  return (
    <Screen header={<AppHeader title="Compare strategies" back />}>
      <AppText variant="body" tone="secondary">
        Compare up to {MAX} frameworks side by side. Only structure is compared — Prop Guard never shows made-up win rates.
      </AppText>

      {list.length < MAX ? (
        <SelectField label={list.length ? 'Add a strategy' : 'Choose a strategy'} value={null} options={options} onChange={(v) => setIds((cur) => [...cur, v].slice(0, MAX))} />
      ) : null}

      {list.length > 0 ? (
        <Card>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.row}>
                <View style={styles.labelCell} />
                {list.map((t) => (
                  <View key={t.id} style={styles.cell}>
                    <AppText variant="bodyStrong" numberOfLines={2}>
                      {t.shortName}
                    </AppText>
                    <View style={styles.cellActions}>
                      <Button label="Rules" size="md" variant="ghost" onPress={() => router.push({ pathname: '/strategy/library/[id]', params: { id: t.id } })} />
                      <Button label="Remove" size="md" variant="ghost" onPress={() => setIds((cur) => cur.filter((x) => x !== t.id))} />
                    </View>
                  </View>
                ))}
              </View>
              {rows.map((r) => (
                <View key={r.label} style={[styles.row, styles.divider]}>
                  <View style={styles.labelCell}>
                    <AppText variant="label" style={{ fontSize: 10 }}>
                      {r.label}
                    </AppText>
                  </View>
                  {r.values.map((v, i) => (
                    <View key={`${r.label}${list[i].id}`} style={styles.cell}>
                      <AppText variant="caption" style={{ color: colors.text }}>
                        {v}
                      </AppText>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      ) : null}

      <AppText variant="caption" tone="tertiary">
        {LIBRARY_DISCLAIMER}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  labelCell: { width: 104, justifyContent: 'flex-start' },
  cell: { width: COL, gap: 2 },
  cellActions: { flexDirection: 'row', marginLeft: -spacing.md },
});
