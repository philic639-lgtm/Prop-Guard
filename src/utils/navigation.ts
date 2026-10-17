import { router, type Href } from 'expo-router';

/**
 * Back, or — when the screen was opened directly (deep link, web refresh) and there is no
 * history — a sensible parent screen. A bare `router.back()` would silently do nothing.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
