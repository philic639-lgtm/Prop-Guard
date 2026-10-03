import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Chip, Input } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';

const FIRMS = ['Lucid Trading', 'Apex', 'Topstep', 'Tradeify', 'My Funded Futures', 'Take Profit Trader', 'Other', 'Manual rules'];

export default function PropFirm() {
  const firm = useOnboardingStore((s) => s.propFirm);
  const set = useOnboardingStore((s) => s.set);
  const [other, setOther] = useState(FIRMS.includes(firm) ? '' : firm);
  const selected = FIRMS.includes(firm) ? firm : firm ? 'Other' : '';

  return (
    <OnboardingScaffold
      step={4}
      title="Select your prop firm"
      subtitle="You'll enter your account's rules next. Prop Guard never assumes firm-specific rules — always use your firm's current terms."
      cta="Continue"
      disabled={!firm}
      onNext={() => router.push('/onboarding/account')}>
      <View style={styles.grid}>
        {FIRMS.map((f) => (
          <Chip key={f} large label={f} selected={selected === f} onPress={() => set({ propFirm: f === 'Other' ? other || 'Other' : f })} />
        ))}
      </View>
      {selected === 'Other' ? (
        <Input
          label="Firm name"
          value={other}
          onChangeText={(t) => {
            setOther(t);
            set({ propFirm: t || 'Other' });
          }}
          placeholder="Firm name"
          autoFocus
        />
      ) : null}
      {selected === 'Manual rules' ? <AppText variant="caption">Great — you&apos;ll define every rule yourself.</AppText> : null}
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md } });
