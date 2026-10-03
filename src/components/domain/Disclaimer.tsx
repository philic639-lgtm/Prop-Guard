import { StyleSheet } from 'react-native';

import { AppText } from '@/components/ui';
import { DISCLAIMER } from '@/constants/legal';
import { spacing } from '@/constants/theme';

/** Quiet, non-intrusive footer disclaimer. */
export function Disclaimer({ text = DISCLAIMER }: { text?: string }) {
  return (
    <AppText variant="caption" tone="tertiary" align="center" style={styles.text}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({ text: { fontSize: 11, lineHeight: 15, marginTop: spacing.md, paddingHorizontal: spacing.md } });
