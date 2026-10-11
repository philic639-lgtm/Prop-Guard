import type { Ionicons } from '@expo/vector-icons';

import type { Tone } from '@/constants/theme';
import type { FollowVerdict } from '@/lib/engines/copyTradeEngine';
import type { CopyAssetClass, CopyMode, CopyPlatform, CopySizingMode, CopyVerdict } from '@/types/copyTrade';

type Icon = keyof typeof Ionicons.glyphMap;

export const VERDICT_UI: Record<CopyVerdict, { tone: Tone; icon: Icon }> = {
  safe: { tone: 'positive', icon: 'shield-checkmark' },
  reduce: { tone: 'warning', icon: 'trending-down' },
  exceeds: { tone: 'danger', icon: 'alert-circle' },
  blocked: { tone: 'danger', icon: 'ban' },
  review: { tone: 'warning', icon: 'help-circle' },
};

export const FOLLOW_UI: Record<FollowVerdict, { tone: Tone; icon: Icon }> = {
  too_few: { tone: 'neutral', icon: 'hourglass-outline' },
  keep: { tone: 'positive', icon: 'checkmark-circle' },
  reduce: { tone: 'warning', icon: 'remove-circle-outline' },
  stop: { tone: 'danger', icon: 'close-circle-outline' },
};

export const PLATFORM_LABEL: Record<CopyPlatform, string> = { discord: 'Discord', telegram: 'Telegram', x: 'X', youtube: 'YouTube', mentor: 'Mentor', friend: 'Friend', other: 'Other' };
export const PLATFORM_ICON: Record<CopyPlatform, Icon> = {
  discord: 'logo-discord',
  telegram: 'paper-plane-outline',
  x: 'logo-twitter',
  youtube: 'logo-youtube',
  mentor: 'school-outline',
  friend: 'people-outline',
  other: 'person-circle-outline',
};
export const ASSET_LABEL: Record<CopyAssetClass, string> = { futures: 'Futures', options: 'Options', stocks: 'Stocks', forex: 'Forex', crypto: 'Crypto', other: 'Other' };
export const SIZING_LABEL: Record<CopySizingMode, string> = { fixed_risk: 'Fixed $ risk', percent_risk: '% of account', scale: 'Scale size', mirror: 'Mirror size' };
export const MODE_LABEL: Record<CopyMode, string> = { live: 'Taken live', simulated: 'Simulated', missed: 'Missed' };
export const STYLES = ['Scalp', 'ORB', 'Swing', 'Trend', 'Breakout', 'Mean reversion', 'Options'];
