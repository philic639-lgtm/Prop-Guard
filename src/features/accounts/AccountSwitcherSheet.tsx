import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Sheet } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useAccountCards } from '@/hooks/useAppData';
import { overview } from '@/lib/engines/accountOverview';
import { useAppStore } from '@/store/useAppStore';

import { AccountCardView } from './AccountCardView';

/** Fast account switch from the dashboard: compact cards, most urgent first; the choice drives every screen. */
export function AccountSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const cards = useAccountCards();
  const setActive = useAppStore((s) => s.setActiveAccount);
  const list = overview(cards, 'all', { now: new Date() });
  return (
    <Sheet visible={visible} onClose={onClose} title="Switch account">
      <View style={styles.gap}>
        {list.map((c) => (
          <AccountCardView
            key={c.id}
            card={c}
            compact
            onOpen={() => {
              setActive(c.id);
              onClose();
            }}
          />
        ))}
        <Button
          label="Manage My Accounts"
          variant="secondary"
          icon="briefcase-outline"
          onPress={() => {
            onClose();
            router.push('/accounts');
          }}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing.sm } });
