import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { diffEconAlerts, isEconAlert, type PlannedAlert } from '@/lib/engines/economicCalendar/alerts';

import { notificationService } from './notificationService';

/**
 * Local phone alerts before scheduled releases (no push server, no cost). Uses the app's
 * existing notification permission flow. Every alert has a deterministic identifier, so
 * applying the plan again never duplicates an alert.
 */
const CHANNEL = 'economic-calendar';
let channelReady = false;

async function ensureChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Economic releases', importance: Notifications.AndroidImportance.HIGH });
  channelReady = true;
}

export async function pendingEconAlerts(): Promise<{ identifier: string; fireAt: string | null }[]> {
  if (!notificationService.supported) return [];
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((r) => isEconAlert(r.identifier)).map((r) => ({ identifier: r.identifier, fireAt: typeof r.content.data?.fireAt === 'string' ? r.content.data.fireAt : null }));
}

/** Bring the phone's pending economic alerts in line with the plan. */
export async function applyEconAlerts(planned: PlannedAlert[]): Promise<{ scheduled: number; cancelled: number; permission: boolean }> {
  if (!notificationService.supported) return { scheduled: 0, cancelled: 0, permission: false };
  const permission = await notificationService.permissionGranted();
  const pending = await pendingEconAlerts();
  // Without permission nothing new is scheduled, but stale alerts are still removed.
  const { cancel, schedule } = diffEconAlerts(permission ? planned : [], pending);
  for (const id of cancel) await Notifications.cancelScheduledNotificationAsync(id);
  if (!permission) return { scheduled: 0, cancelled: cancel.length, permission };
  await ensureChannel();
  for (const a of schedule) {
    await Notifications.scheduleNotificationAsync({
      identifier: a.identifier,
      content: { title: a.title, body: a.body, data: { fireAt: a.fireAt, eventId: a.eventId, url: '/intelligence' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(a.fireAt), ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
    });
  }
  return { scheduled: schedule.length, cancelled: cancel.length, permission };
}
