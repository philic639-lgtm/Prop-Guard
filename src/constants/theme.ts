import { Platform, type TextStyle } from 'react-native';

/**
 * Prop Guard design tokens. Dark-only, calm, high-contrast numerics.
 * Red is reserved for genuine risk states.
 */
export const colors = {
  bg: '#090B0F',
  surface: '#11151B',
  card: '#151A22',
  cardRaised: '#1A202A',
  border: '#242B36',
  borderStrong: '#323B49',

  accent: '#4DA8FF',
  accentPressed: '#3A8FE0',
  accentMuted: 'rgba(77, 168, 255, 0.14)',
  accentOn: '#05101C',

  positive: '#3FB68B',
  positiveMuted: 'rgba(63, 182, 139, 0.14)',
  warning: '#E5A23A',
  warningMuted: 'rgba(229, 162, 58, 0.14)',
  danger: '#E5534B',
  dangerMuted: 'rgba(229, 83, 75, 0.14)',

  text: '#ECEFF4',
  textSecondary: '#8D97A7',
  textTertiary: '#5D6778',
  overlay: 'rgba(3, 5, 8, 0.72)',
} as const;

export type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';

export const toneColor: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.textSecondary, bg: 'rgba(141, 151, 167, 0.12)' },
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
