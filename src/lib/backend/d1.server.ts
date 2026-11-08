// Tiny query builder over Cloudflare D1 that mimics the subset of the old
// `db().from(table).select()...` API used by the backend files.
// Bindings come from the Worker `env` (stashed per request in src/server.ts).

type D1Result = { results?: Record<string, unknown>[]; meta?: { changes?: number } };
type D1Stmt = { bind: (...v: unknown[]) => D1Stmt; all: () => Promise<D1Result>; run: () => Promise<D1Result> };
export type D1Database = { prepare: (sql: string) => D1Stmt };

export function cfEnv(): Record<string, unknown> {
  return ((globalThis as Record<string, unknown>)["__CF_ENV__"] as Record<string, unknown>) || {};
}

export function d1(): D1Database {
  const b = cfEnv()["DB"] as D1Database | undefined;
  if (!b) throw new Error("Database binding DB is missing. Add a D1 binding named DB in Cloudflare.");
  return b;
}

// Columns stored as JSON text / 0-1 integers in SQLite.
const JSON_COLS: Record<string, string[]> = {
  site_state: ["data"],
  site_backups: ["data"],
  tool_data: ["data"],
  tool_zips: ["admin", "files"],
};
const BOOL_COLS: Record<string, string[]> = {
  admin_accounts: ["is_main"],
  media_items: ["opt"],
  media_uploads: ["opt"],
  tool_zips: ["finalized"],
};

const PK_CACHE = new Map<string, string>();
const IDENT = /^[a-z_][a-z0-9_]*$/;
const id = (s: string) => {
  if (!IDENT.test(s)) throw new Error("Bad identifier " + s);
  return `"${s}"`;
};

type Rec = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Res<T = Rec[]> = { data: T; error: { message: string } | null; count?: number | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

class Query<T = Rec[]> implements PromiseLike<Res<T>> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private cols = "*";
  private where: string[] = [];
  private params: unknown[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private off: number | null = null;
  private rows: Record<string, unknown>[] = [];
  private setv: Record<string, unknown> = {};
  private conflict: string | null = null;
  private single: "maybe" | "one" | null = null;
  private countMode = false;
  private headOnly = false;

  constructor(private table: string) {
    id(table);
  }

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.cols = cols;
      if (opts?.count) this.countMode = true;
      if (opts?.head) this.headOnly = true;
    }
    return this;
  }
  insert(v: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.rows = Array.isArray(v) ? v : [v];
    return this;
  }
  upsert(v: Record<string, unknown> | Record<string, unknown>[], o?: { onConflict?: string }) {
    this.op = "upsert";
    this.rows = Array.isArray(v) ? v : [v];
    this.conflict = o?.onConflict || null;
    return this;
  }
  update(v: Record<string, unknown>) {
    this.op = "update";
    this.setv = v;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private w(col: string, sym: string, v: unknown) {
    this.where.push(`${id(col)} ${sym} ?`);
    this.params.push(this.enc(col, v));
    return this;
  }
  eq(c: string, v: unknown) { return this.w(c, "=", v); }
  neq(c: string, v: unknown) { return this.w(c, "<>", v); }
  gt(c: string, v: unknown) { return this.w(c, ">", v); }
  lt(c: string, v: unknown) { return this.w(c, "<", v); }
  lte(c: string, v: unknown) { return this.w(c, "<=", v); }
  gte(c: string, v: unknown) { return this.w(c, ">=", v); }
  order(c: string, o?: { ascending?: boolean }) {
    this.orders.push(`${id(c)} ${o?.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.off = a; this.lim = b - a + 1; return this; }
  maybeSingle(): Query<Rec> { this.single = "maybe"; return this as unknown as Query<Rec>; }
  singleRow() { this.single = "one"; return this; }

  private enc(col: string, v: unknown) {
    if ((JSON_COLS[this.table] || []).includes(col)) return v === undefined || v === null ? null : JSON.stringify(v);
    if (typeof v === "boolean") return v ? 1 : 0;
    return v === undefined ? null : v;
  }
  private dec(r: Record<string, unknown>) {
    for (const c of JSON_COLS[this.table] || []) {
      if (typeof r[c] === "string") {
        try { r[c] = JSON.parse(r[c] as string); } catch { /* keep text */ }
      }
    }
    for (const c of BOOL_COLS[this.table] || []) if (c in r) r[c] = !!r[c];
    return r;
  }
  private whereSql() {
    return this.where.length ? " WHERE " + this.where.join(" AND ") : "";
  }

  async run(): Promise<Res<T>> {
    return this.exec() as unknown as Promise<Res<T>>;
  }

  private async exec(): Promise<Res> {
    try {
      const db = d1();
      const t = id(this.table);
      if (this.op === "select") {
        const cols = this.cols.trim() === "*" ? "*" : this.cols.split(",").map((c) => id(c.trim())).join(", ");
        if (this.headOnly) {
          const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}${this.whereSql()}`).bind(...this.params).all();
          return { data: null as unknown as Rec[], error: null, count: Number(r.results?.[0]?.["n"] || 0) };
        }
        let sql = `SELECT ${cols} FROM ${t}${this.whereSql()}`;
        if (this.orders.length) sql += " ORDER BY " + this.orders.join(", ");
        if (this.single) sql += " LIMIT 1";
        else if (this.lim !== null) sql += ` LIMIT ${Math.floor(this.lim)}` + (this.off !== null ? ` OFFSET ${Math.floor(this.off)}` : "");
        const r = await db.prepare(sql).bind(...this.params).all();
        const rows = (r.results || []).map((x) => this.dec({ ...x }));
        if (this.single) {
          if (!rows.length && this.single === "one") return { data: null as unknown as Rec[], error: { message: "No rows" } };
          return { data: (rows[0] ?? null) as unknown as Rec[], error: null };
        }
        return { data: rows as Rec[], error: null, count: this.countMode ? rows.length : null };
      }
      if (this.op === "insert" || this.op === "upsert") {
        for (const row of this.rows) {
          const keys = Object.keys(row);
          const vals = keys.map((k) => this.enc(k, row[k]));
          let sql = `INSERT INTO ${t} (${keys.map(id).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
          if (this.op === "upsert") {
            const pk = this.conflict || (await this.primaryKey());
            const upd = keys.filter((k) => !pk.split(",").map((s) => s.trim()).includes(k));
            sql += ` ON CONFLICT (${pk.split(",").map((s) => id(s.trim())).join(", ")}) ` +
              (upd.length ? `DO UPDATE SET ${upd.map((k) => `${id(k)} = excluded.${id(k)}`).join(", ")}` : "DO NOTHING");
          }
          await db.prepare(sql).bind(...vals).run();
        }
        return { data: null as unknown as Rec[], error: null };
      }
      if (this.op === "update") {
        const keys = Object.keys(this.setv);
        const sql = `UPDATE ${t} SET ${keys.map((k) => `${id(k)} = ?`).join(", ")}${this.whereSql()}`;
        await db.prepare(sql).bind(...keys.map((k) => this.enc(k, this.setv[k])), ...this.params).run();
        return { data: null as unknown as Rec[], error: null };
      }
      await db.prepare(`DELETE FROM ${t}${this.whereSql()}`).bind(...this.params).run();
      return { data: null as unknown as Rec[], error: null };
    } catch (e) {
      console.error("db error", this.table, e);
      return { data: null as unknown as Rec[], error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private async primaryKey(): Promise<string> {
    // Looked up once per table per Worker instance: a PRAGMA before every upsert would waste
    // D1 queries (each Worker request may only run a limited number of them).
    const cached = PK_CACHE.get(this.table);
    if (cached) return cached;
    const r = await d1().prepare(`PRAGMA table_info(${id(this.table)})`).all();
    const pk = (r.results || []).filter((c) => Number(c["pk"]) > 0).sort((a, b) => Number(a["pk"]) - Number(b["pk"]));
    const key = pk.map((c) => String(c["name"])).join(",") || "id";
    PK_CACHE.set(this.table, key);
    return key;
  }

  then<A = Res<T>, B = never>(ok?: ((v: Res<T>) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, bad);
  }
}

export const sqlDb = { from: (table: string) => new Query(table) };
