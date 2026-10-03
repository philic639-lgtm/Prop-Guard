import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationPrefs, Strategy } from '@/types/domain';
import { easternMinutes, parseClock } from '@/utils/dates';

/**
 * Local notifications for discipline. Push (remote) notifications can be
 * layered on later via an Expo push token stored in Supabase.
 */
export type NotificationKind = keyof NotificationPrefs;

const supported = Platform.OS === 'ios' || Platform.OS === 'android';
const ids: Partial<Record<string, string>> = {};

export const NOTIFICATION_COPY = {
  preSession: { title: 'Pre-session', body: 'Your trading window begins in 15 minutes. Review your Daily Guard.' },
  lossLimit: { title: 'Loss limit', body: "You've used 75% of today's risk budget." },
  tradeLimit: { title: 'Trade limit', body: "You've reached your configured maximum trades." },
  cooldown: { title: 'Cooldown', body: 'Cooldown complete.' },
  journal: { title: 'Journal', body: 'Your session ended 30 minutes ago. Add your notes while the trade is fresh.' },
} as const;

export const notificationService = {
  supported,

  configure() {
    if (!supported) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync('discipline', {
        name: 'Discipline alerts',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  },

  async requestPermission(): Promise<boolean> {
    if (!supported) return false;
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const next = await Notifications.requestPermissionsAsync();
    return next.granted;
  },

  async permissionGranted(): Promise<boolean> {
    if (!supported) return false;
    return (await Notifications.getPermissionsAsync()).granted;
  },

  async notifyNow(kind: NotificationKind, prefs: NotificationPrefs, override?: { title?: string; body?: string }) {
    if (!supported || !prefs[kind]) return;
    if (!(await this.permissionGranted())) return;
    const copy = NOTIFICATION_COPY[kind];
    await Notifications.scheduleNotificationAsync({
      content: { title: override?.title ?? copy.title, body: override?.body ?? copy.body },
      trigger: null,
    });
  },

  async scheduleIn(kind: NotificationKind, seconds: number, prefs: NotificationPrefs, key = kind) {
    if (!supported || !prefs[kind] || seconds <= 0) return;
    if (!(await this.permissionGranted())) return;
    await this.cancel(key);
    const copy = NOTIFICATION_COPY[kind];
    ids[key] = await Notifications.scheduleNotificationAsync({
      content: { title: copy.title, body: copy.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(seconds) },
    });
  },

  async cancel(key: string) {
    const id = ids[key];
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
      delete ids[key];
    }
  },

  /** Weekday pre-session reminders, 15 minutes before the strategy window (ET converted to local). */
  async schedulePreSession(strategy: Strategy | null, prefs: NotificationPrefs) {
    if (!supported) return;
    for (let wd = 2; wd <= 6; wd++) await this.cancel(`pre_${wd}`);
    const start = parseClock(strategy?.entryWindowStart);
    if (!prefs.preSession || start === null || !(await this.permissionGranted())) return;
    const now = new Date();
    const offset = now.getHours() * 60 + now.getMinutes() - easternMinutes(now);
    const local = (((start - 15 + offset) % 1440) + 1440) % 1440;
    for (let weekday = 2; weekday <= 6; weekday++) {
      ids[`pre_${weekday}`] = await Notifications.scheduleNotificationAsync({
        content: NOTIFICATION_COPY.preSession,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: Math.floor(local / 60),
          minute: local % 60,
        },
      });
    }
  },
};
