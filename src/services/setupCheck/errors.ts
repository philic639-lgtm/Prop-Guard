/** Every way a Setup Check can fail, with a trader-friendly message and whether retrying can help. */
export type SetupCheckErrorCode =
  | 'no_strategy'
  | 'no_screenshot'
  | 'image_invalid'
  | 'upload_failed'
  | 'not_configured'
  | 'unavailable'
  | 'malformed'
  | 'no_rules'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'unauthorized';

const MESSAGES: Record<SetupCheckErrorCode, { message: string; retry: boolean }> = {
  no_strategy: { message: 'Choose one of your saved strategies first — Prop Guard checks the chart against YOUR rules.', retry: false },
  no_screenshot: { message: 'Add a chart screenshot to check.', retry: false },
  image_invalid: { message: 'That file isn’t a supported chart image (JPEG, PNG or WebP up to 4 MB). Try another screenshot.', retry: false },
  upload_failed: { message: 'The screenshot couldn’t be prepared. Try picking it again.', retry: true },
  not_configured: { message: 'AI chart analysis isn’t set up for this app yet. Your rules and risk checks still work in the Check Trade screen.', retry: false },
  unavailable: { message: 'The AI analysis service is unavailable right now. Nothing was decided — try again in a moment.', retry: true },
  malformed: { message: 'The analysis came back in an unexpected format, so it was discarded rather than guessed. Try again.', retry: true },
  no_rules: { message: 'This strategy has no rules Prop Guard can check on a chart yet. Add checklist items or entry / confirmation rules to the strategy first.', retry: false },
  rate_limited: { message: 'Too many setup checks in a short time. Wait a minute and try again.', retry: true },
  timeout: { message: 'The analysis took too long. Check your connection and try again.', retry: true },
  network: { message: 'No connection to the analysis service. Check your connection and try again.', retry: true },
  unauthorized: { message: 'Sign in again to use AI setup checks.', retry: false },
};

export class SetupCheckError extends Error {
  readonly retry: boolean;
  constructor(readonly code: SetupCheckErrorCode, detail?: string) {
    super(MESSAGES[code].message + (detail && __DEV__ ? ` (${detail})` : ''));
    this.retry = MESSAGES[code].retry;
  }
}
