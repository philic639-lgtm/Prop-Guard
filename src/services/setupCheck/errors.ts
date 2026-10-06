/** Every way a Setup Check request can fail, with a trader-friendly message and whether retrying can help. */
export type SetupCheckErrorCode =
  | 'no_strategy'
  | 'no_screenshot'
  | 'image_invalid'
  | 'unavailable'
  | 'malformed'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'strategy_not_found'
  | 'account_not_found';

const MESSAGES: Record<SetupCheckErrorCode, { message: string; retry: boolean }> = {
  no_strategy: { message: 'Choose one of your saved strategies first — Setup Check uses YOUR saved rules.', retry: false },
  no_screenshot: { message: 'Add a chart screenshot to run chart analysis.', retry: false },
  image_invalid: { message: 'That file isn’t a supported chart image (JPEG, PNG or WebP up to 10 MB). Try another screenshot.', retry: false },
  unavailable: { message: 'Chart analysis is unavailable right now. Nothing was assumed — confirm rules manually or try again.', retry: true },
  malformed: { message: 'The response came back in an unexpected format and was discarded rather than guessed. Try again.', retry: true },
  rate_limited: { message: 'Too many setup checks in a short time. Wait a minute and try again.', retry: true },
  timeout: { message: 'The check took too long. Check your connection and try again.', retry: true },
  network: { message: 'No connection to Prop Guard’s server. Check your connection and try again.', retry: true },
  unauthorized: { message: 'Sign in again to run setup checks.', retry: false },
  strategy_not_found: { message: 'This strategy hasn’t synced to your account yet. Wait for sync to finish and try again.', retry: true },
  account_not_found: { message: 'This account hasn’t synced to your account yet. Wait for sync to finish and try again.', retry: true },
};

export class SetupCheckError extends Error {
  readonly retry: boolean;
  constructor(readonly code: SetupCheckErrorCode) {
    super(MESSAGES[code].message);
    this.retry = MESSAGES[code].retry;
  }
}

export const isErrorCode = (v: unknown): v is SetupCheckErrorCode => typeof v === 'string' && v in MESSAGES;
