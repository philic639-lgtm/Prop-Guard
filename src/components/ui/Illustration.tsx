import { useId } from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors } from '@/constants/theme';

/**
 * Small branded spot illustrations (SVG, no image assets): a soft gradient
 * tile with a line glyph. Restrained on purpose — a serious trader tool,
 * not a landing page. Used by EmptyState and onboarding / feature intros.
 */
export type IllustrationKind = 'shield' | 'copy' | 'chart' | 'journal' | 'upload' | 'strategy' | 'trades';

const STROKE = { stroke: colors.accentBright, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

function Glyph({ kind }: { kind: IllustrationKind }) {
  switch (kind) {
    case 'shield':
      return (
        <G>
          <Path d="M40 18 L56 24 V38 C56 49 49 57 40 61 C31 57 24 49 24 38 V24 Z" {...STROKE} />
          <Path d="M33 39 L38.5 44.5 L48 34" {...STROKE} stroke={colors.positive} />
        </G>
      );
    case 'copy':
      return (
        <G>
          <Rect x={22} y={26} width={26} height={30} rx={5} {...STROKE} strokeOpacity={0.55} />
          <Rect x={32} y={18} width={26} height={30} rx={5} {...STROKE} />
          <Path d="M38 38 L44 32 L50 36" {...STROKE} stroke={colors.positive} />
        </G>
      );
    case 'chart':
      return (
        <G>
          <Path d="M22 58 H60" {...STROKE} strokeOpacity={0.5} />
          <Path d="M24 50 L33 41 L41 46 L52 31 L58 35" {...STROKE} />
          <Circle cx={52} cy={31} r={3} fill={colors.positive} />
        </G>
      );
    case 'journal':
      return (
        <G>
          <Rect x={25} y={18} width={30} height={42} rx={5} {...STROKE} />
          <Path d="M32 29 H48 M32 37 H48 M32 45 H42" {...STROKE} strokeOpacity={0.7} />
          <Path d="M25 24 H21 M25 32 H21 M25 40 H21 M25 48 H21" {...STROKE} strokeOpacity={0.45} />
        </G>
      );
    case 'upload':
      return (
        <G>
          <Rect x={20} y={22} width={40} height={34} rx={6} {...STROKE} strokeOpacity={0.55} />
          <Path d="M40 48 V30 M33 36 L40 29 L47 36" {...STROKE} />
        </G>
      );
    case 'strategy':
      return (
        <G>
          <Circle cx={28} cy={26} r={5} {...STROKE} />
          <Circle cx={52} cy={30} r={5} {...STROKE} strokeOpacity={0.6} />
          <Circle cx={36} cy={54} r={5} {...STROKE} stroke={colors.positive} />
          <Path d="M32 30 L47 30 M30 31 L35 49" {...STROKE} strokeOpacity={0.7} />
        </G>
      );
    case 'trades':
      return (
        <G>
          <Path d="M28 24 V56 M40 30 V52 M52 20 V48" {...STROKE} strokeOpacity={0.5} />
          <Rect x={24.5} y={32} width={7} height={14} rx={2} fill={colors.positive} />
          <Rect x={36.5} y={36} width={7} height={10} rx={2} fill={colors.danger} />
          <Rect x={48.5} y={26} width={7} height={14} rx={2} fill={colors.positive} />
        </G>
      );
  }
}

export function Illustration({ kind, size = 80 }: { kind: IllustrationKind; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.accent} stopOpacity={0.28} />
          <Stop offset="1" stopColor={colors.accent} stopOpacity={0.04} />
        </LinearGradient>
        <LinearGradient id={`rim${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.accentBright} stopOpacity={0.55} />
          <Stop offset="1" stopColor={colors.accentBright} stopOpacity={0.05} />
        </LinearGradient>
      </Defs>
      <Rect x={4} y={4} width={72} height={72} rx={22} fill={`url(#bg${id})`} stroke={`url(#rim${id})`} strokeWidth={1} />
      <Glyph kind={kind} />
    </Svg>
  );
}

/** The Prop Guard mark: a gradient shield with a check. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.accentBright} />
          <Stop offset="1" stopColor={colors.accent} />
        </LinearGradient>
      </Defs>
      <Path d="M16 2.5 L27 6.6 V15 C27 22.2 22.3 27.6 16 30 C9.7 27.6 5 22.2 5 15 V6.6 Z" fill={`url(#s${id})`} />
      <Path d="M10.8 16 L14.6 19.8 L21.6 12.4" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
