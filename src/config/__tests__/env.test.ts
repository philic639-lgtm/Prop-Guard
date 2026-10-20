import { readSupabaseEnv } from '../env';

const URL = 'https://abcdefghijklmnop.supabase.co';
const PUBLISHABLE = 'sb_publishable_' + 'x'.repeat(31);
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.signature`;

describe('Supabase build variables', () => {
  it('URL without key → not configured, naming the missing variable (never a value)', () => {
    const e = readSupabaseEnv(URL, undefined);
    expect(e.configured).toBe(false);
    expect(e.problem).toMatch(/^EXPO_PUBLIC_SUPABASE_ANON_KEY is not set in this build/);
    expect(e.problem).toMatch(/rebuild/);
    expect(e.problem).not.toContain(URL);
  });

  it('both missing → both named', () => {
    expect(readSupabaseEnv('', '').problem).toMatch(/^EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are not set/);
  });

  it('publishable key or legacy anon JWT → configured; trailing slash trimmed', () => {
    expect(readSupabaseEnv(`${URL}/`, PUBLISHABLE)).toEqual({ url: URL, key: PUBLISHABLE, configured: true, problem: null });
    expect(readSupabaseEnv(URL, jwt('anon')).configured).toBe(true);
  });

  it('a secret or service-role key is refused and never used', () => {
    for (const key of ['sb_secret_' + 'y'.repeat(31), jwt('service_role')]) {
      const e = readSupabaseEnv(URL, key);
      expect(e).toMatchObject({ configured: false, key: '' });
      expect(e.problem).toMatch(/secret \(service-role\) key/);
    }
  });
});
