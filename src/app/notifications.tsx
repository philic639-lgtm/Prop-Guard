import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProGate } from '@/components/domain/ProGate';
import { AppHeader, AppText, Button, Card, Divider, Screen, ToggleRow } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useActiveStrategy } from '@/hooks/useAppData';
import { NOTIFICATION_COPY, notificationService } from '@/services/notificationService';
import { useAppStore } from '@/store/useAppStore';
import type { NotificationPrefs } from '@/types/domain';

const ITEMS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: 'preSession', label: 'Pre-session reminder' },
  { key: 'lossLimit', label: 'Loss-limit warning' },
  { key: 'tradeLimit', label: 'Trade-limit warning' },
  { key: 'cooldown', label: 'Cooldown complete' },
  { key: 'journal', label: 'Journal reminder' },
];

export default function NotificationsScreen() {
  const prefs = useAppStore((s) => s.preferences.notifications);
  const setPref = useAppStore((s) => s.setNotificationPref);
  const strategy = useActiveStrategy();
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void notificationService.permissionGranted().then(setGranted);
  }, []);

  useEffect(() => {
    if (granted) void notificationService.schedulePreSession(strategy, prefs);
  }, [granted, strategy, prefs]);

  return (
    <Screen header={<AppHeader title="Notifications" back />}>
      <ProGate feature="notifications" title="Discipline alerts" description="Pre-session reminders, loss-limit and trade-limit warnings, cooldown and journal nudges.">
        {!notificationService.supported ? (
          <Card>
            <AppText variant="body" tone="secondary">
              Notifications are available on iOS and Android devices.
            </AppText>
          </Card>
        ) : granted === false ? (
          <Card tone="accent">
            <View style={styles.row}>
              <Ionicons name="notifications-off-outline" size={18} color={colors.accent} />
              <AppText variant="bodyStrong">Notifications are off</AppText>
            </View>
            <AppText variant="caption" style={{ marginTop: spacing.xs }}>
              Allow notifications so Prop Guard can warn you before you break a rule.
            </AppText>
            <Button label="Enable notifications" size="md" style={{ marginTop: spacing.md }} onPress={() => void notificationService.requestPermission().then(setGranted)} />
          </Card>
        ) : null}
        <Card>
          {ITEMS.map((item, i) => (
            <View key={item.key}>
              {i > 0 ? <Divider /> : null}
              <ToggleRow label={item.label} description={NOTIFICATION_COPY[item.key].body} value={prefs[item.key]} onChange={(v) => setPref(item.key, v)} />
            </View>
          ))}
        </Card>
        <AppText variant="caption" tone="tertiary">
          Pre-session reminders fire 15 minutes before your active strategy&apos;s entry window on weekdays.
        </AppText>
      </ProGate>
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm } });
