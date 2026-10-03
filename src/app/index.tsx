import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/useAppStore';

export default function Index() {
  const onboarded = useAppStore((s) => s.preferences.onboarded);
  return <Redirect href={onboarded ? '/home' : '/onboarding/welcome'} />;
}
