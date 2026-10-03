import type { Ionicons } from '@expo/vector-icons';

import type { Tone } from '@/constants/theme';
import type { GuardStatus, SetupGrade } from '@/types/domain';

export const GUARD_UI: Record<GuardStatus, { tone: Tone; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  SAFE: { tone: 'positive', label: 'Safe to trade', icon: 'shield-checkmark' },
  CAUTION: { tone: 'warning', label: 'Caution', icon: 'alert-circle' },
  STOP: { tone: 'danger', label: 'Stop trading', icon: 'hand-left' },
};

export const GRADE_UI: Record<SetupGrade, { tone: Tone; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  A_PLUS: { tone: 'positive', label: 'A+ Setup', icon: 'star' },
  VALID: { tone: 'positive', label: 'Valid Setup', icon: 'checkmark-circle' },
  CAUTION: { tone: 'warning', label: 'Caution', icon: 'alert-circle' },
  RULE_VIOLATION: { tone: 'danger', label: 'Rule Violation', icon: 'close-circle' },
  NO_TRADE: { tone: 'danger', label: 'No Trade', icon: 'hand-left' },
};

export function pnlTone(v: number | null | undefined): Tone {
  if (v == null || v === 0) return 'neutral';
  return v > 0 ? 'positive' : 'danger';
}
