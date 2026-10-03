import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Chip, Input, Screen, SegmentedControl } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { INSTRUMENT_SYMBOLS } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { InstrumentSymbol, UserPreferences } from '@/types/domain';

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'UTC'];

export default function PreferencesSettings() {
  const prefs = useAppStore((s) => s.preferences);
  const setPreferences = useAppStore((s) => s.setPreferences);
  const [name, setName] = useState(prefs.displayName);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(prefs.defaultInstrument);
  const [markets, setMarkets] = useState<UserPreferences['markets']>(prefs.markets);
  const [timezone, setTimezone] = useState(prefs.timezone);
  const [tradingType, setTradingType] = useState(prefs.tradingType);

  const toggle = (m: InstrumentSymbol) => setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <Screen
      header={<AppHeader title="Trading preferences" back />}
      footer={
        <Button
          label="Save"
          icon="checkmark"
          onPress={() => {
            setPreferences({ displayName: name.trim(), defaultInstrument: instrument, markets, timezone, tradingType });
            router.back();
          }}
        />
      }>
      <Input label="Name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
      <View style={{ gap: spacing.sm }}>
        <AppText variant="label">Markets you trade</AppText>
        <View style={styles.chips}>
          {INSTRUMENT_SYMBOLS.map((m) => (
            <Chip key={m} label={m} selected={markets.includes(m)} onPress={() => toggle(m)} />
          ))}
        </View>
      </View>
      <SegmentedControl label="Default market" options={INSTRUMENT_SYMBOLS.map((s) => ({ value: s, label: s }))} value={instrument} onChange={setInstrument} />
      <SegmentedControl
        label="How you trade"
        options={[
          { value: 'prop', label: 'Prop firm' },
          { value: 'personal', label: 'Personal' },
          { value: 'both', label: 'Both' },
        ]}
        value={tradingType}
        onChange={setTradingType}
      />
      <View style={{ gap: spacing.sm }}>
        <AppText variant="label">Timezone</AppText>
        <View style={styles.chips}>
          {TIMEZONES.map((tz) => (
            <Chip key={tz} label={tz.replace('America/', '').replace('_', ' ')} selected={timezone === tz} onPress={() => setTimezone(tz)} />
          ))}
        </View>
        <AppText variant="caption">Strategy windows are always in exchange time (ET).</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm } });
