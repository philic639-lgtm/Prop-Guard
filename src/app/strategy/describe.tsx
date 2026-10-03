import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Input, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { blankStrategy } from '@/features/strategy/fromTemplate';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { STRATEGY_EXAMPLE, strategyFromParsed } from '@/lib/engines';
import { aiService } from '@/services/ai';
import { useAppStore } from '@/store/useAppStore';

const TIPS = ['Market and timeframe', 'When you are allowed to trade', 'Entry trigger and confirmation', 'Stop size, minimum R:R and trade limit'];

/** "I have a strategy" — describe it in plain English; AI converts it to measurable rules. */
export default function DescribeStrategy() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const setDraft = useStrategyDraftStore((s) => s.setDraft);
  const maxTrades = useAppStore((s) => s.tradingRules.maxTradesPerDay);

  const convert = async () => {
    setLoading(true);
    try {
      const parsed = await aiService.parseStrategyDescription(text);
      const base = { ...blankStrategy(), maxTrades: Math.min(2, maxTrades) };
      setDraft(strategyFromParsed(parsed, base, text), 'describe', parsed.source);
      router.push('/strategy/review');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      header={<AppHeader title="Teach PropGuard your plan" back />}
      footer={<Button label="Convert to Rules" icon="sparkles" loading={loading} disabled={text.trim().length < 20} onPress={() => void convert()} />}>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">Describe your strategy</AppText>
        <AppText variant="body" tone="secondary">
          Write it the way you would explain it to another trader. Prop Guard turns it into measurable rules you can review and edit.
        </AppText>
      </View>
      <Input
        label="Your strategy"
        value={text}
        onChangeText={setText}
        multiline
        placeholder="I trade a 15 minute ORB on ES. I wait until after 9:45…"
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
        Prop Guard only converts rules you state. It never adds signals or predicts results.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm } });
