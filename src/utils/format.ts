/** Display formatting. Trading numbers must be easy to scan. */

export function money(value: number | null | undefined, opts: { cents?: boolean; sign?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = opts.cents ? 2 : 0;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: opts.cents ? 2 : 0 });
  if (value < 0) return `-$${body}`;
  if (opts.sign && value > 0) return `+$${body}`;
  return `$${body}`;
}

export function signedMoney(value: number | null | undefined): string {
  return money(value, { sign: true });
}

export function points(value: number | null | undefined, sign = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const s = Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0$/, '');
  return `${sign && value > 0 ? '+' : ''}${s} pts`;
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function rr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `1 : ${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function rMultiple(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

export function factor(value: number | null | undefined): string {
  if (value == null) return '—';
  if (!Number.isFinite(value)) return '∞';
  return value.toFixed(2);
}

export function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Parse user-typed numeric input. Returns null for empty / invalid. */
export function parseNum(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function numToInput(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}
