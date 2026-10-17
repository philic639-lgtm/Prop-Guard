import { Platform, type TextStyle } from 'react-native';

/**
 * Prop Guard design tokens. Dark-only, calm, high-contrast numerics.
 * Red is reserved for genuine risk states.
 */
export const colors = {
  bg: '#060A13',
  surface: '#0B111D',
  card: '#0E1524',
  cardRaised: '#121B2E',
  border: '#1B2740',
  borderStrong: '#26385A',

  accent: '#1F7BFF',
  accentPressed: '#1666DB',
  accentBright: '#4DA3FF',
  accentMuted: 'rgba(31, 123, 255, 0.16)',
  accentOn: '#FFFFFF',

  positive: '#22C55E',
  positivePressed: '#1AA64E',
  positiveMuted: 'rgba(34, 197, 94, 0.14)',
  warning: '#F5B70B',
  warningMuted: 'rgba(245, 183, 11, 0.14)',
  danger: '#EF4444',
  dangerMuted: 'rgba(239, 68, 68, 0.14)',

  text: '#F1F5FB',
  textSecondary: '#93A1B8',
  textTertiary: '#5B6A84',
  overlay: 'rgba(2, 5, 10, 0.78)',
} as const;

export type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';

export const toneColor: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.textSecondary, bg: 'rgba(147, 161, 184, 0.12)' },
  accent: { fg: colors.accent, bg: colors.accentMuted },
  positive: { fg: colors.positive, bg: colors.positiveMuted },
  warning: { fg: colors.warning, bg: colors.warningMuted },
  danger: { fg: colors.danger, bg: colors.dangerMuted },
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

/** Screen gutter. */
export const GUTTER = spacing.xl;

const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  hero: { fontSize: 40, fontWeight: '700', letterSpacing: -1, color: colors.text, ...numeric },
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6, color: colors.text, ...numeric },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, color: colors.text },
  heading: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, color: colors.text },
  number: { fontSize: 20, fontWeight: '600', color: colors.text, ...numeric },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21, color: colors.text },
  bodyStrong: { fontSize: 15, fontWeight: '600', color: colors.text },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18, color: colors.textSecondary },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  mono: {
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    color: colors.text,
    ...numeric,
  },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  default: { elevation: 6 },
});

export const TAB_BAR_HEIGHT = 64;

/** Remove the browser focus ring on web text inputs (the field border shows focus instead). */
export const webNoOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as TextStyle;
