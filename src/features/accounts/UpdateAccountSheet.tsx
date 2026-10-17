import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Sheet } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useImportSession } from '@/features/accountImport/useImportSession';
import { MAX_IMAGES, pickImages } from '@/services/accountImport/images';
import type { Account } from '@/types/domain';

/**
 * "Update Account": screenshot, photo or manual — for ONE chosen account. The picture is
 * picked here (inside the tap, so browsers allow the file chooser) and read on the
 * import screen in update mode for this account; nothing is saved before the trader
 * confirms the old → new values.
 */
export function UpdateAccountSheet({ account, visible, onClose }: { account: Account; visible: boolean; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fromImage = async (source: 'library' | 'camera') => {
    setError(null);
    setBusy(true);
    const r = await pickImages(source, MAX_IMAGES);
    setBusy(false);
    if (r.status === 'cancelled') return;
    if (r.status === 'denied') return setError(source === 'camera' ? 'Camera access was denied. Allow it in Settings, or upload a screenshot.' : 'Photo access was denied. Allow it in Settings, or update manually.');
    if (r.status === 'error') return setError(r.message);
    const session = useImportSession.getState();
    session.reset();
    session.add(r.images);
    onClose();
    router.push({ pathname: '/accounts/import', params: { accountId: account.id, autoread: '1' } });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Update ${account.name}`}>
      <View style={styles.gap}>
        <AppText variant="caption" tone="secondary">
          Use your firm’s latest account overview. You’ll see the saved values next to the new ones before anything changes.
        </AppText>
        <Button label="Upload Screenshot" icon="upload-screenshot" loading={busy} onPress={() => void fromImage('library')} />
        <Button label="Take Photo" icon="camera-outline" variant="secondary" onPress={() => void fromImage('camera')} />
        <Button
          label="Manual Update"
          icon="create-outline"
          variant="ghost"
          onPress={() => {
            onClose();
            router.push({ pathname: '/accounts/details', params: { id: account.id } });
          }}
        />
        {error ? (
          <AppText variant="caption" tone="danger" accessibilityRole="alert">
            {error}
          </AppText>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing.sm } });
