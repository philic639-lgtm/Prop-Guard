import { AppHeader, AppText, Screen } from '@/components/ui';
import { Disclaimer } from '@/components/domain/Disclaimer';
import { PLANS } from '@/config/plans';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { LibraryCard } from '@/features/strategy/LibraryCard';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

export default function LibraryScreen() {
  const plan = useSubscriptionStore((s) => s.plan);
  const limit = PLANS[plan].limits.libraryTemplates;
  return (
    <Screen header={<AppHeader title="Strategy library" subtitle="Educational templates" back />}>
      <AppText variant="caption">{LIBRARY_DISCLAIMER}</AppText>
      {STRATEGY_LIBRARY.map((t, i) => (
        <LibraryCard key={t.id} template={t} locked={i >= limit} />
      ))}
      <Disclaimer />
    </Screen>
  );
}
