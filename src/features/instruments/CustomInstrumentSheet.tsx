import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Input, NumericInput, Sheet, ToggleRow } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { makeCustomInstrument, type InstrumentSpec } from '@/data/instruments';
import { findInstrument } from '@/lib/engines/instrumentEngine';
import { parseNum } from '@/utils/format';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (spec: InstrumentSpec) => void;
}

/** Define a contract that is not in the catalog. Point value is derived from tick size and tick value. */
export function CustomInstrumentSheet({ visible, onClose, onSave }: Props) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [tickSize, setTickSize] = useState('');
  const [tickValue, setTickValue] = useState('');
  const [isMicro, setIsMicro] = useState(false);
  const [tried, setTried] = useState(false);

  const sym = symbol.trim().toUpperCase();
  const ts = parseNum(tickSize);
  const tv = parseNum(tickValue);
  const errors = {
    symbol: !/^[A-Z0-9]{1,8}$/.test(sym) ? 'Use 1–8 letters or digits' : findInstrument(sym) ? `${sym} already exists` : null,
    tickSize: ts == null || ts <= 0 ? 'Enter the minimum price increment' : null,
    tickValue: tv == null || tv <= 0 ? 'Enter the dollar value of one tick' : null,
  };
  const valid = !errors.symbol && !errors.tickSize && !errors.tickValue;
  const pointValue = valid ? tv! / ts! : null;

  const reset = () => {
    setSymbol('');
    setName('');
    setTickSize('');
    setTickValue('');
    setIsMicro(false);
    setTried(false);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add custom instrument">
      <AppText variant="caption">
        Use your broker&apos;s contract specs. Prop Guard uses these numbers for every risk, sizing and P&L calculation on this instrument.
      </AppText>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input label="Ticker" value={symbol} onChangeText={setSymbol} placeholder="HG" autoCapitalize="characters" autoCorrect={false} error={tried ? errors.symbol : null} />
        </View>
        <View style={[styles.flex, { flex: 1.6 }]}>
          <Input label="Name" value={name} onChangeText={setName} placeholder="Copper" />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Tick size" value={tickSize} onChangeText={setTickSize} placeholder="0.0005" error={tried ? errors.tickSize : null} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Tick value" prefix="$" value={tickValue} onChangeText={setTickValue} placeholder="12.50" error={tried ? errors.tickValue : null} />
        </View>
      </View>
      <ToggleRow label="Micro contract" description="Smaller-size version of a standard contract." value={isMicro} onChange={setIsMicro} />
      <AppText variant="bodyStrong" tone={pointValue ? 'accent' : 'tertiary'}>
        Point value: {pointValue ? `$${pointValue.toLocaleString('en-US', { maximumFractionDigits: 4 })} per 1.0 move` : '—'}
      </AppText>
      <Button
        label="Add instrument"
        icon="add"
        onPress={() => {
          setTried(true);
          if (!valid) return;
          onSave(makeCustomInstrument({ symbol: sym, name, tickSize: ts!, tickValue: tv!, isMicro }));
          reset();
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
