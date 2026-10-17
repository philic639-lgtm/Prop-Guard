import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AppHeader, Screen, SegmentedControl } from '@/components/ui';
import { AccountCopierPanel } from '@/features/copyTrade/AccountCopierPanel';
import { FollowTradersPanel } from '@/features/copyTrade/FollowTradersPanel';

type Section = 'copier' | 'follow';

/**
 * Copy Trade tab.
 * - Trade Copier: master → follower accounts (setup & preview only — no broker is connected).
 * - Follow Traders: copy other traders' ideas, sized to your account and checked against your rules.
 */
export default function CopyTradeTab() {
  const params = useLocalSearchParams<{ section?: Section }>();
  const [section, setSection] = useState<Section>(params.section === 'follow' ? 'follow' : 'copier');
  return (
    <Screen tabBar header={<AppHeader title="Copy Trade" subtitle="Copy smarter, not bigger" />}>
      <SegmentedControl
        options={[
          { value: 'copier', label: 'Trade Copier' },
          { value: 'follow', label: 'Follow Traders' },
        ]}
        value={section}
        onChange={setSection}
      />
      {section === 'copier' ? <AccountCopierPanel /> : <FollowTradersPanel />}
    </Screen>
  );
}
