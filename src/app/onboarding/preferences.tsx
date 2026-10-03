import { router } from 'expo-router';

import { ChoiceGrid } from '@/components/ui';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';

export default function TradingPreferences() {
  const profile = useOnboardingStore((s) => s.profile);
  const setProfile = useOnboardingStore((s) => s.setProfile);
  const markets = useOnboardingStore((s) => s.markets);
  const set = useOnboardingStore((s) => s.set);
  const primary = markets[0] ?? 'ES';

  return (
    <OnboardingScaffold step={4} title="Tell us about your trading style" subtitle="This helps Prop Guard create rules and checks that fit you." cta="Continue" onNext={() => router.push('/onboarding/rules')}>
      <ChoiceGrid
        label="Primary instrument"
        columns={Math.min(4, Math.max(2, markets.length))}
        options={markets.map((m) => ({ value: m, label: m }))}
        value={primary}
        onChange={(m) => set({ markets: [m, ...markets.filter((x) => x !== m)] })}
      />
      <ChoiceGrid
        label="Trading style"
        options={[
          { value: 'scalp', label: 'Scalp', sub: 'Seconds–minutes' },
          { value: 'intraday', label: 'Intraday', sub: 'Within session' },
          { value: 'swing', label: 'Swing', sub: 'Multi-hour' },
        ]}
        value={profile.style}
        onChange={(style) => setProfile({ style })}
      />
      <ChoiceGrid
        label="Preferred session"
        options={[
          { value: 'ny_open', label: 'New York Open' },
          { value: 'morning', label: 'Morning' },
          { value: 'afternoon', label: 'Afternoon' },
        ]}
        value={profile.session}
        onChange={(session) => setProfile({ session })}
      />
      <ChoiceGrid
        label="Experience level"
        options={[
          { value: 'beginner', label: 'Beginner' },
          { value: 'intermediate', label: 'Intermediate' },
          { value: 'advanced', label: 'Advanced' },
        ]}
        value={profile.experience}
        onChange={(experience) => setProfile({ experience })}
      />
      <ChoiceGrid
        label="Typical hold time"
        columns={4}
        options={[
          { value: 'lt5', label: '< 5 min' },
          { value: '5to30', label: '5–30 min' },
          { value: '30to120', label: '30–120 min' },
          { value: 'hours', label: 'Hours' },
        ]}
        value={profile.holdTime}
        onChange={(holdTime) => setProfile({ holdTime })}
      />
      <ChoiceGrid
        label="Risk preference"
        options={[
          { value: 'conservative', label: 'Conservative', sub: 'Tight stops' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'aggressive', label: 'Aggressive', sub: 'Wider stops' },
        ]}
        value={profile.riskPreference}
        onChange={(riskPreference) => setProfile({ riskPreference })}
      />
    </OnboardingScaffold>
  );
}
