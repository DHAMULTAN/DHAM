// Admin accounts, sign-in sessions and the activity log for the website's admin panel.
import {
  clientIp,
  db,
  fail,
  fullIp,
  hashPassword,
  json,
  now,
  randHex,
  safeEqual,
  sha256Hex,
  verifyPassword,
} from "./util.server";

export type Role = "owner" | "editor";
export type Session = { user: string; role: Role; isMain: boolean; tokenHash: string };

const SESSION_MS = 12 * 60 * 60 * 1000;
const LOCK_WINDOW = 15 * 60 * 1000;
const LOCK_MAX = 8; // failed attempts per IP address
const LOCK_MAX_USER = 20; // failed attempts per username (stops attacks spread over many addresses)
const USER_RE = /^[a-z0-9._@-]{4,40}$/;
const MAX_USER_LEN = 80;
const MAX_PASS_LEN = 200; // long enough for any passphrase, short enough that hashing cannot be abused

// A real hash that is checked when the username does not exist, so a wrong username takes as long
// to reject as a wrong password and the response time does not reveal which usernames exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randHex(16)));

export async function logAct(request: Request | null, who: string, action: string, detail = "") {
  try {
    await db()
      .from("activity_log")
      .insert({
        at: now(),
        who: who.slice(0, 60),
        action,
        detail: detail.slice(0, 500),
        ip: request ? clientIp(request) : "",
        ua: request ? (request.headers.get("user-agent") || "").slice(0, 200) : "",
      });
    const { data } = await db().from("activity_log").select("id").order("id", { ascending: false }).range(300, 300);
    if (data?.[0]) await db().from("activity_log").delete().lte("id", data[0].id);
  } catch (e) {
    console.error("activity log failed", e);
  }
}

async function roleOf(name: string): Promise<Role> {
  const { data } = await db().from("admin_account_roles").select("role").eq("account_name", name);
  return (data || []).some((r) => r.role === "owner") ? "owner" : "editor";
}

async function setRole(name: string, role: Role) {
  await db().from("admin_account_roles").delete().eq("account_name", name);
  const { error } = await db().from("admin_account_roles").insert({ account_name: name, role });
  if (error) throw new Error(error.message);
}

export async function getSession(request: Request): Promise<Session | null> {
  const token = request.headers.get("x-admin-token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const { data } = await db()
    .from("admin_sessions")
    .select("account_name, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;
  const t = now();
  if (data.expires_at < t) {
    await db().from("admin_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  if (data.expires_at - t < SESSION_MS / 2) {
    await db().from("admin_sessions").update({ expires_at: t + SESSION_MS }).eq("token_hash", tokenHash);
  }
  const { data: acct } = await db().from("admin_accounts").select("is_main").eq("name", data.account_name).maybeSingle();
  if (!acct) return null;
  return { user: data.account_name, role: await roleOf(data.account_name), isMain: !!acct?.is_main, tokenHash };
}

async function mainAccount() {
  const { data } = await db().from("admin_accounts").select("name, pass_hash").eq("is_main", true).maybeSingle();
  return data;
}

async function createSession(name: string): Promise<string> {
  const token = randHex(32);
  const t = now();
  await db()
    .from("admin_sessions")
    .insert({ token_hash: await sha256Hex(token), account_name: name, expires_at: t + SESSION_MS, created_at: t });
  await db().from("admin_sessions").delete().lt("expires_at", t);
  return token;
}

export async function login(request: Request, body: { user?: string; pass?: string }): Promise<Response> {
  const rawUser = String(body.user || "").trim().toLowerCase();
  const rawPass = String(body.pass || "");
  const oversize = rawUser.length > MAX_USER_LEN || rawPass.length > MAX_PASS_LEN;
  // oversized input can never be a valid login: treat it as a failed attempt without hashing it
  const user = oversize ? "" : rawUser;
  const pass = oversize ? "" : rawPass;
  const key = "ip:" + fullIp(request);
  const userKey = user ? "user:" + user : "";
  const t = now();

  for (const [k, max] of [
    [key, LOCK_MAX],
    [userKey, LOCK_MAX_USER],
  ] as const) {
    if (!k) continue;
    const { count } = await db()
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("key", k)
      .gt("at", t - LOCK_WINDOW);
    if ((count || 0) >= max) {
      const { data: first } = await db()
        .from("login_attempts")
        .select("at")
        .eq("key", k)
        .gt("at", t - LOCK_WINDOW)
        .order("at", { ascending: true })
        .limit(1);
      const wait = first?.[0] ? Math.max(60000, first[0].at + LOCK_WINDOW - t) : LOCK_WINDOW;
      return json({ ok: false, error: "Too many attempts.", wait }, 429);
    }
  }

  let ok = false;
  let name = user;
  const main = await mainAccount();

  const { data: acct } = user
    ? await db().from("admin_accounts").select("name, pass_hash").eq("name", user).maybeSingle()
    : { data: null };

  if (acct) {
    if (await verifyPassword(pass, acct.pass_hash)) {
      ok = true;
      name = acct.name;
    }
  } else if (main) {
    await verifyPassword(pass, await getDummyHash()); // equalise timing for unknown usernames
  } else {
    // First sign-in: the owner login comes from the ADMIN_USERNAME / ADMIN_PASSWORD settings.
    const cu = (process.env["ADMIN_USERNAME"] || "").trim().toLowerCase();
    const cp = process.env["ADMIN_PASSWORD"] || "";
    if (!cu || !cp) {
      return fail(503, "The admin login has not been set up yet. Add the owner username and password in the project settings.");
    }
    if (safeEqual(user, cu) && safeEqual(pass, cp)) {
      const { error } = await db()
        .from("admin_accounts")
        .insert({ name: cu, pass_hash: await hashPassword(cp), is_main: true, created_at: t });
      if (error) return fail(500, "Could not create the owner account.");
      await setRole(cu, "owner");
      name = cu;
      ok = true;
    }
  }

  if (!ok) {
    await db().from("login_attempts").insert({ key, at: t });
    if (userKey) await db().from("login_attempts").insert({ key: userKey, at: t });
    await db().from("login_attempts").delete().lt("at", t - 24 * 60 * 60 * 1000);
    await logAct(request, user || "(blank)", "login-failed");
    return fail(401, "Wrong username or password.");
  }

  await db().from("login_attempts").delete().eq("key", key);
  if (userKey) await db().from("login_attempts").delete().eq("key", userKey);
  const token = await createSession(name);
  const role = await roleOf(name);
  await logAct(request, name, "login", role);
  return json({ ok: true, token, user: name, role });
}

export async function logout(request: Request, s: Session | null): Promise<Response> {
  if (s) {
    await db().from("admin_sessions").delete().eq("token_hash", s.tokenHash);
    await logAct(request, s.user, "logout");
  }
  return json({ ok: true });
}

export async function setCred(
  request: Request,
  s: Session,
  b: { currentUser?: string; currentPass?: string; newUser?: string; newPass?: string },
): Promise<Response> {
  if (s.role !== "owner") return fail(403, "Only the owner can change the owner login.");
  const main = await mainAccount();
  if (!main) return fail(400, "No owner account exists yet.");
  const cu = String(b.currentUser || "").trim().toLowerCase();
  if (cu !== main.name || !(await verifyPassword(String(b.currentPass || ""), main.pass_hash))) {
    await logAct(request, s.user, "account", "owner login change refused: wrong current login");
    return fail(400, "The current username or password is wrong. Nothing was changed.");
  }
  const nu = String(b.newUser || "").trim().toLowerCase();
  const np = String(b.newPass || "");
  if (!USER_RE.test(nu)) return fail(400, "Username: 4-40 letters, numbers, . _ @ or -");
  if (np.length < 10) return fail(400, "Password needs at least 10 characters.");
  if (np.length > MAX_PASS_LEN) return fail(400, `Password can be at most ${MAX_PASS_LEN} characters.`);
  if (nu !== main.name) {
    const { data: taken } = await db().from("admin_accounts").select("name").eq("name", nu).maybeSingle();
    if (taken) return fail(400, "That username is already used by a team member.");
  }
  const { error } = await db()
    .from("admin_accounts")
    .update({ name: nu, pass_hash: await hashPassword(np) })
    .eq("name", main.name);
  if (error) return fail(500, "Could not save the new login.");
  // sign out every other device of the owner account
  await db().from("admin_sessions").delete().eq("account_name", nu).neq("token_hash", s.tokenHash);
  await logAct(request, nu, "account", "owner username/password changed");
  return json({ ok: true });
}

export async function listUsers(s: Session): Promise<Response> {
  if (s.role !== "owner") return fail(403, "Only the owner can manage the team.");
  const { data } = await db()
    .from("admin_accounts")
    .select("name, created_at")
    .eq("is_main", false)
    .order("created_at");
  const { data: allRoles } = await db().from("admin_account_roles").select("account_name, role");
  const users = (data || []).map((u) => {
    const roles = (allRoles || []).filter((r) => r.account_name === u.name) as { role: Role }[];
    return { name: u.name, role: roles.some((r) => r.role === "owner") ? "owner" : "editor", at: u.created_at };
  });
  return json({ ok: true, users });
}

export async function addUser(request: Request, s: Session, b: { user?: string; role?: string; newPass?: string }) {
  if (s.role !== "owner") return fail(403, "Only the owner can manage the team.");
  const u = String(b.user || "").trim().toLowerCase();
  const role: Role = b.role === "owner" ? "owner" : "editor";
  const p = String(b.newPass || "");
  if (!USER_RE.test(u)) return fail(400, "Username: 4-40 letters, numbers, . _ @ or -");
  if (p.length < 10) return fail(400, "Password needs at least 10 characters.");
  if (p.length > MAX_PASS_LEN) return fail(400, `Password can be at most ${MAX_PASS_LEN} characters.`);
  const main = await mainAccount();
  if (main && main.name === u) return fail(400, "That is the main owner login. Change it in Account instead.");
  const { error } = await db()
    .from("admin_accounts")
    .upsert({ name: u, pass_hash: await hashPassword(p), is_main: false, created_at: now() }, { onConflict: "name" });
  if (error) return fail(500, "Could not save the team member.");
  await setRole(u, role);
  await db().from("admin_sessions").delete().eq("account_name", u);
  await logAct(request, s.user, "account", `team member ${u} saved as ${role}`);
  return json({ ok: true });
}

export async function delUser(request: Request, s: Session, b: { user?: string }) {
  if (s.role !== "owner") return fail(403, "Only the owner can manage the team.");
  const u = String(b.user || "").trim().toLowerCase();
  const { data: acct } = await db().from("admin_accounts").select("is_main").eq("name", u).maybeSingle();
  if (!acct) return fail(404, "No such team member.");
  if (acct.is_main) return fail(400, "The main owner login cannot be removed.");
  await db().from("admin_sessions").delete().eq("account_name", u);
  await db().from("admin_account_roles").delete().eq("account_name", u);
  await db().from("admin_accounts").delete().eq("name", u);
  await logAct(request, s.user, "account", `team member ${u} removed`);
  return json({ ok: true });
}

export async function readLog(): Promise<Response> {
  const { data } = await db()
    .from("activity_log")
    .select("at, who, action, detail, ip, ua")
    .order("at", { ascending: false })
    .limit(300);
  return json({ ok: true, log: data || [] });
}
