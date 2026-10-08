import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, ChoiceGrid, SectionHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { POPULAR_INSTRUMENTS, type InstrumentSpec } from '@/data/instruments';
import { CustomInstrumentSheet } from '@/features/instruments/CustomInstrumentSheet';
import { InstrumentBrowser } from '@/features/instruments/InstrumentBrowser';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStep } from '@/features/onboarding/steps';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { findInstrument, getInstrument, setCustomInstruments } from '@/lib/engines/instrumentEngine';

export default function Markets() {
  const markets = useOnboardingStore((s) => s.markets);
  const customs = useOnboardingStore((s) => s.customInstruments);
  const set = useOnboardingStore((s) => s.set);
  const { step, total } = useOnboardingStep('markets');
  const [browsing, setBrowsing] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);

  const toggle = (symbol: string) => set({ markets: markets.includes(symbol) ? markets.filter((m) => m !== symbol) : [...markets, symbol] });

  const addCustom = (spec: InstrumentSpec) => {
    const next = [...customs.filter((c) => c.symbol !== spec.symbol), spec];
    // Register immediately so the browser, risk engine and later steps can price it.
    setCustomInstruments(next, 'draft');
    set({ customInstruments: next, markets: markets.includes(spec.symbol) ? markets : [...markets, spec.symbol] });
    setAddingCustom(false);
  };

  const others = markets.filter((m) => !POPULAR_INSTRUMENTS.includes(m) && findInstrument(m));

  return (
    <OnboardingScaffold
      step={step}
      total={total}
      title="What do you trade?"
      subtitle="Select every futures contract you trade. Prop Guard uses each contract's tick size and value in every risk calculation."
      cta={markets.length ? `Continue · ${markets.length} selected` : 'Continue'}
      disabled={markets.length === 0}
      onNext={() => router.push('/onboarding/experience')}>
      <SectionHeader title="Popular instruments" />
      <ChoiceGrid
        columns={2}
        options={POPULAR_INSTRUMENTS.map((s) => ({ value: s, label: s, sub: getInstrument(s).name }))}
        value={null}
        isSelected={(s) => markets.includes(s)}
        onChange={toggle}
      />

      <Button label="Browse All Instruments" variant="secondary" icon="search" onPress={() => setBrowsing(true)} />

      {others.length > 0 ? (
        <View style={styles.selected}>
          <AppText variant="label">Also selected</AppText>
          <View style={styles.chips}>
            {others.map((s) => (
              <Pressable key={s} accessibilityRole="button" accessibilityLabel={`Remove ${s}`} onPress={() => toggle(s)} style={styles.chip}>
                <AppText variant="bodyStrong" style={{ color: colors.text, fontSize: 14 }}>
                  {s}
                </AppText>
                <AppText variant="caption" numberOfLines={1} style={{ maxWidth: 140 }}>
                  {findInstrument(s)?.name}
                </AppText>
                <Ionicons name="close" size={14} color={colors.textSecondary} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel="Add custom instrument" onPress={() => setAddingCustom(true)} style={({ pressed }) => [styles.custom, pressed && { opacity: 0.85 }]}>
        <View style={styles.customIcon}>
          <Ionicons name="add" size={22} color={colors.accentBright} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">Add Custom Instrument</AppText>
          <AppText variant="caption">Trade something else? Enter its tick size and tick value.</AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>

      <InstrumentBrowser
        visible={browsing}
        selected={markets}
        onToggle={toggle}
        onClose={() => setBrowsing(false)}
        onAddCustom={() => {
          setBrowsing(false);
          setAddingCustom(true);
        }}
      />
      <CustomInstrumentSheet visible={addingCustom} onClose={() => setAddingCustom(false)} onSave={addCustom} />
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  selected: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: '#0D1B33',
  },
  custom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent + '88',
    backgroundColor: colors.card,
  },
  customIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
});
