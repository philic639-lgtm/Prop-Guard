import { Text, type TextProps } from 'react-native';

import { colors, toneColor, type Tone, type TypeVariant, type as typeStyles } from '@/constants/theme';

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone | 'primary' | 'secondary' | 'tertiary';
  align?: 'left' | 'center' | 'right';
}

export function AppText({ variant = 'body', tone, align, style, ...rest }: AppTextProps) {
  const color =
    tone === 'primary'
      ? colors.text
      : tone === 'secondary'
        ? colors.textSecondary
        : tone === 'tertiary'
          ? colors.textTertiary
          : tone
            ? toneColor[tone].fg
            : undefined;
  return (
    <Text
      maxFontSizeMultiplier={1.4}
      style={[typeStyles[variant], color ? { color } : null, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
