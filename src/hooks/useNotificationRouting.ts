import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { notificationService } from '@/services/notificationService';

/** Routes a notification may open (anything else in `data.url` is ignored). */
const ALLOWED = new Set(['/intelligence']);

function open(response: Notifications.NotificationResponse | null | undefined) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string' && ALLOWED.has(url) && response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) router.push(url as '/intelligence');
}

/** Tapping an economic-release alert opens Intelligence — while running, and after a cold start. */
export function useNotificationRouting(ready: boolean) {
  const handledColdStart = useRef(false);
  useEffect(() => {
    if (!ready || !notificationService.supported) return;
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      open(Notifications.getLastNotificationResponse());
    }
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready]);
}
