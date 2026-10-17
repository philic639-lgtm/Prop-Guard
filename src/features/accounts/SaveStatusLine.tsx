import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, spacing } from '@/constants/theme';
import { syncService } from '@/services/syncService';
import { useAppStore } from '@/store/useAppStore';

/**
 * Where this account's saved values live — stated, never assumed:
 *  - no cloud account: "Stored on this device only" (cloud sync is not presented as active);
 *  - signed in: "Saved to your cloud account" only after the server confirmed the write
 *    (read back), otherwise "Saved on this device — uploading" or the upload error + Retry.
 */
export function SaveStatusLine({ accountId }: { accountId: string }) {
  const user = useAppStore((s) => s.user);
  const pending = useAppStore((s) => s.sync.unsynced.includes(`account:${accountId}`));
  const error = useAppStore((s) => s.sync.error);

  if (!user) {
    return (
      <View style={styles.row}>
        <Icon name="cloud-offline-outline" size={14} color={colors.textTertiary} />
        <AppText variant="caption" tone="tertiary" style={styles.flex}>
          Stored on this device only — cloud sync is not set up.
        </AppText>
      </View>
    );
  }
  if (pending && error) {
    return (
      <View style={styles.gap}>
        <View style={styles.row}>
          <Icon name="alert-circle-outline" size={14} color={colors.warning} />
          <AppText variant="caption" tone="warning" style={styles.flex}>
            Saved on this device, but not in your cloud account yet: {error}
          </AppText>
        </View>
        <Button label="Retry upload" icon="refresh" variant="ghost" size="md" onPress={() => void syncService.retry()} />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Icon name={pending ? 'cloud-upload-outline' : 'cloud-done-outline'} size={14} color={pending ? colors.textSecondary : colors.positive} />
      <AppText variant="caption" tone="secondary" style={styles.flex}>
        {pending ? 'Saved on this device — uploading to your cloud account…' : 'Saved to your cloud account.'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  gap: { gap: spacing.xs },
  flex: { flex: 1 },
});
