import { AppHeader, AppText, Card, Screen } from '@/components/ui';
import { AI_DISCLAIMER, DISCLAIMER, LIBRARY_DISCLAIMER } from '@/constants/legal';
import { spacing } from '@/constants/theme';

const SECTIONS = [
  { title: 'Disclaimer', body: DISCLAIMER },
  { title: 'AI', body: `${AI_DISCLAIMER} When AI is enabled, only minimized trade-plan data is sent (never your name, email, account names or balances). Extracted screenshot values always require your confirmation.` },
  { title: 'Strategy library', body: LIBRARY_DISCLAIMER },
  { title: 'Your data', body: 'Without an account, data stays on this device. When signed in, data is stored in Supabase with row-level security so only you can read it. Screenshots are stored in a private bucket under your user folder. You can export or erase your data at any time.' },
  { title: 'No broker access', body: 'Prop Guard V1 never connects to your broker and cannot place, modify or cancel orders.' },
];

export default function PrivacyScreen() {
  return (
    <Screen header={<AppHeader title="Privacy & disclaimer" back />}>
      {SECTIONS.map((s) => (
        <Card key={s.title}>
          <AppText variant="label">{s.title}</AppText>
          <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
            {s.body}
          </AppText>
        </Card>
      ))}
    </Screen>
  );
}
