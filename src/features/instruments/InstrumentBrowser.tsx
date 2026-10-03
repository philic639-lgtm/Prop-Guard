import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Input, Sheet } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { CATEGORY_LABEL } from '@/data/instruments';
import { allInstruments, groupByCategory, searchInstruments } from '@/lib/engines/instrumentEngine';

import { InstrumentRow } from './InstrumentRow';

interface Props {
  visible: boolean;
  selected: readonly string[];
  onToggle: (symbol: string) => void;
  onClose: () => void;
  onAddCustom?: () => void;
}

/** Searchable, category-grouped, multi-select futures picker. */
export function InstrumentBrowser({ visible, selected, onToggle, onClose, onAddCustom }: Props) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const results = searchInstruments(query, allInstruments());
    return query.trim() ? [{ category: null, items: results }] : groupByCategory(results);
    // The registry changes when custom instruments are added while the sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, visible, selected]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Sheet visible={visible} onClose={onClose} title={`All instruments · ${selected.length} selected`}>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search ticker or name — e.g. CL, gold, yen"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search instruments"
      />
      {total === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search" size={22} color={colors.textTertiary} />
          <AppText variant="body" tone="secondary" align="center">
            No contract matches “{query.trim()}”.
          </AppText>
          {onAddCustom ? <Button label="Add custom instrument" variant="secondary" size="md" icon="add" onPress={onAddCustom} /> : null}
        </View>
      ) : null}
      {groups.map((g) => (
        <View key={g.category ?? 'results'} style={styles.group}>
          {g.category ? (
            <AppText variant="label" accessibilityRole="header">
              {CATEGORY_LABEL[g.category]}
            </AppText>
          ) : null}
          {g.items.map((spec) => (
            <InstrumentRow key={spec.symbol} spec={spec} selected={selected.includes(spec.symbol)} onToggle={onToggle} />
          ))}
        </View>
      ))}
      <Button label={`Done${selected.length ? ` · ${selected.length} selected` : ''}`} onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
});
