import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Input, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { STRATEGY_EXAMPLE } from '@/lib/engines';

const TIPS = ['Market and timeframe', 'When you are allowed to trade', 'Entry trigger and confirmation', 'Stop, target and trade limit', 'When you do NOT trade'];

/**
 * "I have a strategy" — describe ANY strategy in plain English. Prop Guard
 * analyses exactly what was typed. The example only fills the input when the
 * trader presses "Use example"; it never takes part in analysis otherwise.
 */
export default function DescribeStrategy() {
  // Start from the last submitted text (editing after going back), never from an example.
  const [text, setText] = useState(() => useStrategyAnalysisStore.getState().text);
  const submit = useStrategyAnalysisStore((s) => s.submit);

  const analyze = () => {
    submit(text.trim());
    router.push('/strategy/analysis');
  };

  return (
    <Screen
      header={<AppHeader title="Teach PropGuard your plan" back />}
      footer={<Button label="Analyze My Strategy" icon="sparkles" disabled={text.trim().length < 20} onPress={analyze} />}>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">Describe your strategy</AppText>
        <AppText variant="body" tone="secondary">
          Write it the way you would explain it to another trader — any style, even if it is rough or incomplete. Prop Guard finds what is vague or missing and helps you make it measurable.
        </AppText>
      </View>
      <Input
        label="Your strategy"
        value={text}
        onChangeText={setText}
        multiline
        placeholder="What you trade, what you wait for, how you enter, where your stop and target go…"
        inputStyle={{ minHeight: 170 }}
        hint={`${text.trim().length} characters`}
      />
      <Button label="Use example" variant="secondary" size="md" icon="document-text-outline" onPress={() => setText(STRATEGY_EXAMPLE)} />
      <Card>
        <View style={styles.row}>
          <Ionicons name="bulb-outline" size={18} color={colors.warning} />
          <AppText variant="label">Include</AppText>
        </View>
        {TIPS.map((t) => (
          <View key={t} style={[styles.row, { marginTop: spacing.sm }]}>
            <Ionicons name="checkmark" size={16} color={colors.positive} />
            <AppText variant="body">{t}</AppText>
          </View>
        ))}
      </Card>
      <AppText variant="caption" tone="tertiary">
        Prop Guard keeps your words, labels its own interpretations, and never adds a suggestion to your plan unless you accept it. It does not predict results.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm } });
