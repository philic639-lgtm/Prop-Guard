import { Redirect } from 'expo-router';

/** The old "Final strategy" sheet: the plan screen is now the one view of the trader's plan. */
export default function FinalStrategyRedirect() {
  return <Redirect href="/strategy/analysis" />;
}
