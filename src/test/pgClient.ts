/**
 * Test-only stand-in for the Supabase JS client: the query-builder calls the repository
 * makes (`from().select/upsert/insert/update/delete`, filters, order, limit, maybeSingle)
 * are turned into SQL and run through `psql` as the `authenticated` role with
 * `request.jwt.claim.sub` set — the same thing PostgREST does — so row-level security,
 * column names, types, checks and foreign keys are all exercised for real.
 *
 * Used only by the opt-in integration test (`PG_TEST_URL`); never shipped in the app.
 */
// Node built-in, loaded with require: the app tsconfig has no Node typings (this file only runs under Jest).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync } = require('node:child_process') as {
  execFileSync: (cmd: string, args: string[], opts: { input: string; encoding: 'utf8'; stdio: string[] }) => string;
};

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};
const lit = (v: unknown) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

export function runSql(url: string, sql: string, userId: string | null): string {
  const claims = userId
    ? `set local role authenticated; set local "request.jwt.claim.sub" = ${lit(userId)}; set local "request.jwt.claim.role" = 'authenticated';`
    : '';
  return execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin; ${claims}\n${sql};\ncommit;`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

const primaryKeys = new Map<string, string[]>();
function pk(url: string, table: string): string[] {
  if (!primaryKeys.has(table)) {
    const out = runSql(
      url,
      `select string_agg(a.attname, ',' order by a.attnum) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ${lit(`public.${table}`)}::regclass and i.indisprimary`,
      null,
    );
    primaryKeys.set(table, out.split(','));
  }
  return primaryKeys.get(table)!;
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
  private rows: Row[] = [];
  private patch: Row = {};
  private filters: string[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private single = false;

  constructor(
    private readonly url: string,
    private readonly table: string,
    private readonly userId: string,
  ) {}

  select() {
    return this;
  }
  upsert(r: Row | Row[]) {
    this.op = 'upsert';
    this.rows = Array.isArray(r) ? r : [r];
    return this;
  }
  insert(r: Row | Row[]) {
    this.op = 'insert';
    this.rows = Array.isArray(r) ? r : [r];
    return this;
  }
  update(p: Row) {
    this.op = 'update';
    this.patch = p;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push(`${ident(c)} = ${lit(v)}`);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push(`${ident(c)} < ${lit(v)}`);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push(vs.length ? `${ident(c)}::text in (${vs.map(lit).join(',')})` : 'false');
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.orders.push(`${ident(c)} ${o?.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private sql(): string {
    const t = `public.${ident(this.table)}`;
    const where = this.filters.length ? ` where ${this.filters.join(' and ')}` : '';
    if (this.op === 'select') {
      const q = `select * from ${t}${where}${this.orders.length ? ` order by ${this.orders.join(', ')}` : ''}${this.lim != null ? ` limit ${this.lim}` : ''}`;
      return `select coalesce(json_agg(x), '[]') from (${q}) x`;
    }
    if (this.op === 'update') {
      const sets = Object.entries(this.patch).map(([k, v]) => `${ident(k)} = ${lit(v)}`);
      return `update ${t} set ${sets.join(', ')}${where}`;
    }
    if (this.op === 'delete') return `delete from ${t}${where}`;
    // PostgREST semantics: the column list is the union of keys; jsonb_populate_recordset
    // casts each JSON value to the column type exactly as the API would.
    const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
    const colList = cols.map(ident).join(', ');
    const json = lit(JSON.stringify(this.rows));
    let sql = `insert into ${t} (${colList}) select ${colList} from jsonb_populate_recordset(null::${t}, ${json}::jsonb)`;
    if (this.op === 'upsert') {
      const keys = pk(this.url, this.table);
      const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`);
      sql += ` on conflict (${keys.map(ident).join(', ')}) do ${updates.length ? `update set ${updates.join(', ')}` : 'nothing'}`;
    }
    return sql;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    let res: Result;
    try {
      const out = runSql(this.url, this.sql(), this.userId);
      if (this.op === 'select') {
        const rows = JSON.parse(out || '[]') as Row[];
        res = { data: this.single ? (rows[0] ?? null) : rows, error: null };
      } else res = { data: null, error: null };
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      res = { data: null, error: { message: (err.stderr || err.message).trim() } };
    }
    return Promise.resolve(res).then(ok, fail);
  }
}

/** A minimal SupabaseClient look-alike bound to one signed-in user. */
export function pgClient(url: string, userId: string) {
  return { from: (table: string) => new Query(url, table, userId) };
}
