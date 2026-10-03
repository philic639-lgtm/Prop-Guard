import { Redirect } from 'expo-router';

/** Analytics now lives in the Performance tab. */
export default function AnalyticsRedirect() {
  return <Redirect href="/performance" />;
}
