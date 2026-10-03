import { router } from 'expo-router';

import { ProGate } from '@/components/domain/ProGate';
import { AppHeader, Screen } from '@/components/ui';
import { ChartImport } from '@/features/analyze/ChartImport';
import { newDraft } from '@/features/session/draft';
import { useActiveStrategy } from '@/hooks/useAppData';
import { useAppStore } from '@/store/useAppStore';

export default function ScreenshotScreen() {
  const strategy = useActiveStrategy();
  const setDraft = useAppStore((s) => s.setDraft);

  return (
    <Screen header={<AppHeader title="Analyze setup" back />}>
      <ProGate feature="screenshotAnalysis" title="Screenshot analysis" description="Upload a TradingView, Tradovate or NinjaTrader screenshot and extract the trade plan.">
        <ChartImport
          cta="Continue to trade check"
          onUse={(v) => {
            const base = useAppStore.getState().draft ?? newDraft(strategy, v.instrument);
            setDraft({ ...base, instrument: v.instrument, direction: v.direction, entry: v.entry, stop: v.stop, target: v.target, source: 'screenshot', screenshotUri: v.imageUri });
            router.replace('/analyze');
          }}
        />
      </ProGate>
    </Screen>
  );
}
