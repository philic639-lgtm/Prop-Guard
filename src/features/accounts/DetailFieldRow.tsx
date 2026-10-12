import { StyleSheet, View } from 'react-native';

import { AppText, Input, StatusBadge } from '@/components/ui';
import type { IconName } from '@/components/ui/Icon';
import { spacing, type Tone } from '@/constants/theme';
import { ORIGIN_LABEL, type DetailOrigin } from '@/lib/engines/accountDetails';

export const ORIGIN_TONE: Record<DetailOrigin, Tone> = { screenshot: 'accent', verified_program: 'positive', calculated: 'neutral', manual: 'neutral', missing: 'warning' };
export const ORIGIN_ICON: Record<DetailOrigin, IconName> = {
  screenshot: 'camera-outline',
  verified_program: 'shield-checkmark',
  calculated: 'calculator-outline',
  manual: 'create-outline',
  missing: 'alert-circle-outline',
};

/** Where a value comes from — always next to the value, never implied. */
export function OriginBadge({ origin, label }: { origin: DetailOrigin; label?: string }) {
  return <StatusBadge label={label ?? ORIGIN_LABEL[origin]} tone={ORIGIN_TONE[origin]} icon={ORIGIN_ICON[origin]} size="sm" />;
}

interface Props {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  origin: DetailOrigin;
  /** Overrides the origin label (e.g. "Changed — will be saved as entered by you"). */
  originLabel?: string;
  error?: string | null;
  note?: string | null;
  money?: boolean;
  placeholder?: string;
  editable?: boolean;
}

/** One editable account value with its source and an explanation when it is missing. */
export function DetailFieldRow({ label, value, onChangeText, origin, originLabel, error, note, money = true, placeholder, editable = true }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <AppText variant="label" style={styles.flex}>
          {label}
        </AppText>
        <OriginBadge origin={origin} label={originLabel} />
      </View>
      <Input
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        prefix={money ? '$' : undefined}
        keyboardType={money ? 'decimal-pad' : 'default'}
        placeholder={placeholder ?? (money ? 'Not set' : '')}
        error={error}
        editable={editable}
        inputMode={money ? 'decimal' : 'text'}
      />
      {note ? (
        <AppText variant="caption" tone={origin === 'missing' ? 'warning' : 'tertiary'}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 120 },
});
