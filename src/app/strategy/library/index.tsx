import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/domain/Disclaimer';
import { AppHeader, AppText, Button, Card, Chip, EmptyState, HeaderIconButton, Input, Screen, SectionHeader, Sheet } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import {
  CONDITION_LABEL,
  SESSION_LABEL,
  STRATEGY_LIBRARY,
  type Complexity,
  type MarketCondition,
  type SessionKey,
  type StrategyTemplate,
  type TimeframeKey,
} from '@/data/strategyLibrary';
import { finderAnswersFromProfile } from '@/features/strategy/finderProfile';
import { LibraryCard } from '@/features/strategy/LibraryCard';
import { activeFilterCount, filterTemplates, LIBRARY_CHIPS, matchTemplates, type LibraryChip, type LibraryFilters, type RRPreference } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

const SECTIONS: { chip: LibraryChip; title: string }[] = [
  { chip: 'orb', title: 'Opening range' },
  { chip: 'trend', title: 'Trend' },
  { chip: 'vwap', title: 'VWAP' },
  { chip: 'breakout', title: 'Breakout' },
  { chip: 'reversal', title: 'Reversal' },
  { chip: 'liquidity', title: 'Liquidity' },
];

const TIMEFRAMES: TimeframeKey[] = ['1m', '5m', '15m', '1h'];
const CONDITIONS: MarketCondition[] = ['trending', 'range', 'high_volatility', 'moderate_volatility', 'low_volatility', 'reversal'];
const LEVELS: Complexity[] = ['Beginner', 'Intermediate', 'Advanced'];
const RRS: RRPreference[] = [1, 1.5, 2, 3];
const ALL_INSTRUMENTS = [...new Set(STRATEGY_LIBRARY.flatMap((t) => t.instruments))];

export default function LibraryScreen() {
  const plan = useSubscriptionStore((s) => s.plan);
  const strategies = useAppStore((s) => s.strategies);
  const recentIds = useAppStore((s) => s.recentTemplateIds);
  const prefs = useAppStore((s) => s.preferences);
  const rules = useAppStore((s) => s.tradingRules);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<LibraryChip>('all');
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState(false);

  const limit = PLANS[plan].limits.libraryTemplates;
  const locked = useMemo(() => new Set(STRATEGY_LIBRARY.slice(limit).map((t) => t.id)), [limit]);
  const savedIds = useMemo(() => new Set(strategies.map((s) => s.libraryId).filter((x): x is string => !!x)), [strategies]);
  const forYou = useMemo(() => matchTemplates(finderAnswersFromProfile(prefs, rules), 3), [prefs, rules]);
  const instruments = useMemo(() => [...prefs.markets.filter((m) => ALL_INSTRUMENTS.includes(m)), ...ALL_INSTRUMENTS.filter((m) => !prefs.markets.includes(m))], [prefs.markets]);

  const full: LibraryFilters = { ...filters, query, chip };
  const results = useMemo(() => filterTemplates(STRATEGY_LIBRARY, { ...filters, query, chip }), [filters, query, chip]);
  const filterCount = activeFilterCount(filters);
  const browsing = !query.trim() && chip === 'all' && filterCount === 0 && !showAll;

  const card = (t: StrategyTemplate, badge?: string) => <LibraryCard key={t.id} template={t} locked={locked.has(t.id)} saved={savedIds.has(t.id)} badge={badge} />;
  const byId = (id: string) => STRATEGY_LIBRARY.find((t) => t.id === id);
  const saved = STRATEGY_LIBRARY.filter((t) => savedIds.has(t.id));
  const recent = recentIds.map(byId).filter((t): t is StrategyTemplate => !!t && !savedIds.has(t.id)).slice(0, 3);
  const popular = STRATEGY_LIBRARY.filter((t) => t.popular);

  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => setFilters((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  const clearAll = () => {
    setFilters({});
    setQuery('');
    setChip('all');
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Strategy Library"
          back
          right={<HeaderIconButton icon="compass-outline" label="Find something repeatable" onPress={() => router.push('/strategy/finder')} />}
        />
      }>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">Strategy Library</AppText>
        <AppText variant="body" tone="secondary">
          Explore rule-based trading frameworks and find setups that fit the way you trade.
        </AppText>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.flex}>
          <Input value={query} onChangeText={setQuery} placeholder="Search strategies" accessibilityLabel="Search strategies" autoCorrect={false} returnKeyType="search" />
        </View>
        <Button label={filterCount ? `Filters · ${filterCount}` : 'Filters'} icon="options-outline" variant="secondary" size="md" onPress={() => setSheet(true)} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {LIBRARY_CHIPS.map((c) => (
          <Chip key={c.key} label={c.label} selected={chip === c.key} onPress={() => setChip(c.key)} />
        ))}
      </ScrollView>

      {browsing ? (
        <>
          <SectionHeader title="For you" action="Find my match" onAction={() => router.push('/strategy/finder')} />
          <AppText variant="caption">Based on your markets, session and risk settings. Fit describes structure, not results.</AppText>
          {forYou.map((m) => {
            const t = byId(m.templateId);
            return t ? card(t, `${m.fitScore}% fit`) : null;
          })}

          {saved.length > 0 ? (
            <>
              <SectionHeader title="Saved" />
              {saved.map((t) => card(t))}
            </>
          ) : null}

          {recent.length > 0 ? (
            <>
              <SectionHeader title="Recently used" />
              {recent.map((t) => card(t))}
            </>
          ) : null}

          <SectionHeader title="Popular frameworks" />
          {popular.map((t) => card(t))}

          {SECTIONS.map((sec) => {
            const list = filterTemplates(STRATEGY_LIBRARY, { chip: sec.chip }).filter((t) => !t.popular);
            if (!list.length) return null;
            return (
              <View key={sec.chip} style={styles.section}>
                <SectionHeader title={sec.title} action={`See all`} onAction={() => setChip(sec.chip)} />
                {list.slice(0, 2).map((t) => card(t))}
              </View>
            );
          })}

          <Button label={`View all ${STRATEGY_LIBRARY.length} strategies`} variant="secondary" icon="list-outline" onPress={() => setShowAll(true)} />
        </>
      ) : (
        <>
          <View style={styles.resultsHead}>
            <AppText variant="label">
              {results.length} {results.length === 1 ? 'strategy' : 'strategies'}
            </AppText>
            {!browsing ? <Button label="Clear" variant="ghost" size="md" onPress={() => { clearAll(); setShowAll(false); }} /> : null}
          </View>
          {results.length ? (
            results.map((t) => card(t))
          ) : (
            <Card>
              <EmptyState icon="search-outline" title="No strategies match" message="Try fewer filters or a different search." actionLabel="Clear filters" onAction={clearAll} />
            </Card>
          )}
        </>
      )}

      <Disclaimer text={LIBRARY_DISCLAIMER} />

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Filter strategies">
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.lg }}>
          <FilterGroup title="Instrument">
            {instruments.map((i) => (
              <Chip key={i} label={i} selected={filters.instrument === i} onPress={() => set('instrument', i)} />
            ))}
          </FilterGroup>
          <FilterGroup title="Session">
            {(Object.keys(SESSION_LABEL) as SessionKey[]).map((k) => (
              <Chip key={k} label={SESSION_LABEL[k]} selected={filters.session === k} onPress={() => set('session', k)} />
            ))}
          </FilterGroup>
          <FilterGroup title="Timeframe">
            {TIMEFRAMES.map((k) => (
              <Chip key={k} label={k} selected={filters.timeframe === k} onPress={() => set('timeframe', k)} />
            ))}
          </FilterGroup>
          <FilterGroup title="Market condition">
            {CONDITIONS.map((k) => (
              <Chip key={k} label={CONDITION_LABEL[k]} selected={filters.condition === k} onPress={() => set('condition', k)} />
            ))}
          </FilterGroup>
          <FilterGroup title="Experience level">
            {LEVELS.map((k) => (
              <Chip key={k} label={k} selected={filters.experience === k} onPress={() => set('experience', k)} />
            ))}
          </FilterGroup>
          <FilterGroup title="Preferred risk / reward">
            {RRS.map((k) => (
              <Chip key={k} label={k === 3 ? '1:3+' : `1:${k}`} selected={filters.riskReward === k} onPress={() => set('riskReward', k)} />
            ))}
          </FilterGroup>
        </ScrollView>
        <View style={styles.sheetFoot}>
          <Button label="Reset" variant="ghost" size="md" onPress={() => setFilters({})} />
          <Button label={`Show ${filterTemplates(STRATEGY_LIBRARY, full).length} strategies`} size="md" style={styles.flex} onPress={() => setSheet(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.groupHead}>
        <Ionicons name="funnel-outline" size={12} color={colors.textTertiary} />
        <AppText variant="label">{title}</AppText>
      </View>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { gap: spacing.sm },
  section: { gap: spacing.md },
  resultsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sheetFoot: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, alignItems: 'center' },
});
