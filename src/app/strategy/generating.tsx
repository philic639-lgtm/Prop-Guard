import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { colors, GUTTER, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { finderAnswersFromProfile } from '@/features/strategy/finderProfile';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { aiService, type StrategyFinderAnswers } from '@/services/ai';
import { useAppStore } from '@/store/useAppStore';

const STEPS = [
  'Analyzing your preferences…',
  'Selecting market structure…',
  'Building entry conditions…',
  'Setting risk parameters…',
  'Creating position rules…',
  'Finalizing your strategy…',
];

/** "Help me build a strategy" — generates a starter plan from the trader's profile. */
export default function GeneratingPlan() {
  const insets = useSafeAreaInsets();
  const [done, setDone] = useState(0);
  const [spin] = useState(() => new Animated.Value(0));
  const setDraft = useStrategyDraftStore((s) => s.setDraft);

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    const timers = STEPS.map((_, i) => setTimeout(() => setDone(i + 1), 450 * (i + 1)));

    const st = useAppStore.getState();
    const instrument = st.preferences.markets[0] ?? st.preferences.defaultInstrument;
    const answers: StrategyFinderAnswers = finderAnswersFromProfile(st.preferences, st.tradingRules);
    let alive = true;
    const started = Date.now();
    void aiService.recommendStrategies(answers).then((recs) => {
      const t = getTemplate(recs[0]?.templateId ?? 'orb-15') ?? getTemplate('orb-15')!;
      const strategy = { ...strategyFromTemplate(t, [instrument]), maxTrades: Math.min(t.defaults.maxTrades, st.tradingRules.maxTradesPerDay) };
      setDraft(strategy, 'build', 'local');
      const wait = Math.max(0, 450 * STEPS.length + 400 - (Date.now() - started));
      setTimeout(() => alive && router.replace('/strategy/review'), wait);
    });
    return () => {
      alive = false;
      loop.stop();
      timers.forEach(clearTimeout);
    };
  }, [spin, setDraft]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <AppText variant="title" align="center">
        CREATING YOUR{'\n'}TRADING PLAN
      </AppText>
      <View style={styles.orbWrap}>
        <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
        <View style={styles.orb}>
          <AppText style={styles.ai}>AI</AppText>
        </View>
      </View>
      <View style={styles.steps} accessibilityLiveRegion="polite">
        {STEPS.map((s, i) => (
          <View key={s} style={styles.step}>
            <Ionicons name={i < done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={i < done ? colors.positive : colors.textTertiary} />
            <AppText variant="body" tone={i < done ? 'primary' : 'tertiary'}>
              {s}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: GUTTER, alignItems: 'center' },
  orbWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.xxxl },
  ring: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 3,
    borderColor: colors.accent,
    borderTopColor: 'transparent',
    borderLeftColor: colors.accentBright,
  },
  orb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: colors.accentBright,
    backgroundColor: '#0A1A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ai: { fontSize: 46, fontWeight: '800', color: colors.accentBright },
  steps: { gap: spacing.lg, alignSelf: 'stretch' },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
