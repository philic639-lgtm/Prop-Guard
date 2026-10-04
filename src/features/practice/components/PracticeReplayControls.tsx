import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Chip } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';

export type ReplaySpeed = 1 | 2 | 4;

interface PracticeReplayControlsProps {
  playing: boolean;
  speed: ReplaySpeed;
  position: number;
  total: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
  onSpeed: (s: ReplaySpeed) => void;
}

/** Play / pause / step / restart controls for the market replay. */
export function PracticeReplayControls(p: PracticeReplayControlsProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Ctrl icon="play-skip-back" label="Restart" onPress={p.onRestart} />
        <Ctrl icon="chevron-back" label="Previous candle" onPress={p.onPrev} disabled={p.position <= 0} />
        <Ctrl icon={p.playing ? 'pause' : 'play'} label={p.playing ? 'Pause' : 'Play'} onPress={p.onPlayPause} primary disabled={!p.playing && p.position >= p.total} />
        <Ctrl icon="chevron-forward" label="Next candle" onPress={p.onNext} disabled={p.position >= p.total} />
      </View>
      <View style={styles.row}>
        <AppText variant="caption" style={styles.flex}>
          Candle {p.position} of {p.total} after your decision
        </AppText>
        {([1, 2, 4] as ReplaySpeed[]).map((s) => (
          <Chip key={s} label={`${s}x`} selected={p.speed === s} onPress={() => p.onSpeed(s)} />
        ))}
      </View>
    </View>
  );
}

function Ctrl({ icon, label, onPress, primary, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.ctrl, primary && styles.primary, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.8 }]}>
      <Ionicons name={icon} size={primary ? 24 : 20} color={primary ? colors.accentOn : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  flex: { flex: 1 },
  ctrl: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  primary: { width: 60, height: 60, backgroundColor: colors.accent, borderColor: colors.accent },
});
