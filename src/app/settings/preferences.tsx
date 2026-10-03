import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Chip, Input, Screen, SegmentedControl, SelectField } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { CustomInstrumentSheet } from '@/features/instruments/CustomInstrumentSheet';
import { InstrumentBrowser } from '@/features/instruments/InstrumentBrowser';
import { instrumentOptions } from '@/lib/engines';
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
  const [browsing, setBrowsing] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const customInstruments = prefs.customInstruments;

  const toggle = (m: InstrumentSymbol) => setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <Screen
      header={<AppHeader title="Trading preferences" back />}
      footer={
        <Button
          label="Save"
          icon="checkmark"
          disabled={markets.length === 0}
          onPress={() => {
            const defaultInstrument = markets.includes(instrument) ? instrument : markets[0];
            setPreferences({ displayName: name.trim(), defaultInstrument, markets, timezone, tradingType });
            router.back();
          }}
        />
      }>
      <Input label="Name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
      <View style={{ gap: spacing.sm }}>
        <AppText variant="label">Markets you trade</AppText>
        <View style={styles.chips}>
          {markets.map((m) => (
            <Chip key={m} label={m} selected onPress={() => toggle(m)} />
          ))}
          <Chip label="Browse all" icon="search" onPress={() => setBrowsing(true)} />
          <Chip label="Custom" icon="add" onPress={() => setAddingCustom(true)} />
        </View>
        <AppText variant="caption">Tap a selected instrument to remove it.</AppText>
      </View>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="label">Default market</AppText>
        <SelectField label="Default market" value={instrument} options={instrumentOptions(markets).filter((o) => markets.includes(o.value))} onChange={setInstrument} />
      </View>
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
      <CustomInstrumentSheet
        visible={addingCustom}
        onClose={() => setAddingCustom(false)}
        onSave={(spec) => {
          setPreferences({ customInstruments: [...customInstruments.filter((c) => c.symbol !== spec.symbol), spec] });
          setMarkets((cur) => (cur.includes(spec.symbol) ? cur : [...cur, spec.symbol]));
          setAddingCustom(false);
        }}
      />
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
