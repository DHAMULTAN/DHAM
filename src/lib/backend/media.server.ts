// /api/media: the admin photo & video library. Files live in private storage and are
// served to visitors at /media/<id>.
import { getSession, logAct } from "./auth.server";
import {
  db,
  fail,
  json,
  looksLikeImage,
  now,
  randHex,
  readBufferLimited,
  tooLarge,
  storageGet,
  storagePut,
  storageRemove,
  TUS_CHUNK,
  mpComplete,
  mpCreate,
  mpPart,
} from "./util.server";

const MAX_IMG = 15 * 1024 * 1024;
const MAX_VID = 60 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,150}$/;
const MAX_JSON_BODY = 64 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function makeId(name: string, type: string): string {
  const base =
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "file";
  return `${randHex(5)}-${base}.${EXT[type] || "bin"}`;
}

type Row = { id: string; name: string; type: string; size: number; alt: string; opt: boolean; kind: string; at: number };
const item = (r: Row) => ({ ...r, url: "/media/" + r.id });

export async function mediaRequest(request: Request): Promise<Response> {
  const s = await getSession(request);
  if (!s) return fail(401, "Not signed in.");
  const url = new URL(request.url);
  const a = url.searchParams.get("a") || "";

  try {
    if (request.method === "GET" && !a) {
      const { data } = await db().from("media_items").select("*").order("at", { ascending: false });
      return json({ ok: true, items: (data || []).map(item) });
    }
    if (request.method !== "POST") return fail(405, "Method not allowed.");

    if (a === "upload") {
      const type = (request.headers.get("content-type") || "").split(";")[0]!.trim();
      if (!/^image\/(jpeg|png|webp|gif|avif|svg\+xml)$/.test(type)) return fail(400, "Only JPG, PNG, WebP, GIF or AVIF pictures.");
      const buf = await readBufferLimited(request, MAX_IMG);
      if (!buf) return fail(413, "This picture is larger than 15 MB.");
      if (!buf.byteLength) return fail(400, "Empty file.");
      if (!looksLikeImage(type, buf)) return fail(400, "This file is not a valid " + type.replace("image/", "").toUpperCase() + " picture.");
      let name = "picture";
      try {
        name = decodeURIComponent(request.headers.get("x-name") || "picture").slice(0, 120);
      } catch {
        /* keep default */
      }
      const id = makeId(name, type);
      await storagePut("media", id, buf, type);
      const row: Row = { id, name, type, size: buf.byteLength, alt: "", opt: request.headers.get("x-opt") === "1", kind: "image", at: now() };
      const { error } = await db().from("media_items").insert(row);
      if (error) throw new Error(error.message);
      await logAct(request, s.user, "media", "uploaded " + name);
      return json({ ok: true, item: item(row) });
    }

    const jsonRaw = await readBufferLimited(request, MAX_JSON_BODY);
    if (!jsonRaw) return tooLarge();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- request JSON
    let body: any = {};
    try {
      body = JSON.parse(new TextDecoder().decode(jsonRaw) || "{}");
    } catch {
      /* empty body */
    }
    if (!body || typeof body !== "object") body = {};

    if (a === "delete") {
      const id = String(body.id || "");
      if (!ID_RE.test(id)) return fail(400, "Bad id.");
      await storageRemove("media", [id]).catch(() => {});
      await db().from("media_items").delete().eq("id", id);
      await logAct(request, s.user, "media", "deleted " + id);
      return json({ ok: true });
    }
    if (a === "alt") {
      const id = String(body.id || "");
      if (!ID_RE.test(id)) return fail(400, "Bad id.");
      await db().from("media_items").update({ alt: String(body.alt || "").slice(0, 300) }).eq("id", id);
      return json({ ok: true });
    }
    if (a === "flag") {
      const id = String(body.id || "");
      if (!ID_RE.test(id)) return fail(400, "Bad id.");
      await db().from("media_items").update({ opt: !!body.opt }).eq("id", id);
      return json({ ok: true });
    }
    if (a === "vstart") {
      const size = Math.floor(Number(body.size || 0));
      const type = body.type === "video/webm" ? "video/webm" : "video/mp4";
      if (!size || size > MAX_VID) return fail(413, "Videos must be smaller than 60 MB.");
      const name = String(body.name || "video").slice(0, 120);
      const id = makeId(name, type);
      // forget unfinished uploads older than a day (their records and part lists would pile up forever)
      const { data: stale } = await db().from("media_uploads").select("id").lt("created_at", now() - 24 * 3600 * 1000);
      for (const u of stale || []) {
        await db().from("media_upload_parts").delete().eq("id", String(u.id));
        await db().from("media_uploads").delete().eq("id", String(u.id));
      }
      const uploadUrl = await mpCreate("media", id, type);
      await db()
        .from("media_uploads")
        .insert({ id, upload_url: uploadUrl, name, type, size, opt: !!body.opt, chunk: TUS_CHUNK, created_at: now() });
      return json({ ok: true, id, chunk: TUS_CHUNK });
    }
    return fail(400, "Unknown action.");
  } catch (e) {
    console.error("media error", e);
    return fail(500, e instanceof Error ? e.message : "Server error");
  }
}

// vchunk sends raw bytes, so it is handled before the JSON body is read.
export async function mediaChunk(request: Request): Promise<Response> {
  const s = await getSession(request);
  if (!s) return fail(401, "Not signed in.");
  const url = new URL(request.url);
  const a = url.searchParams.get("a");
  try {
    if (a === "vchunk") {
      const id = url.searchParams.get("id") || "";
      const n = Number(url.searchParams.get("n") || 0);
      if (!ID_RE.test(id)) return fail(400, "Bad id.");
      const { data: up } = await db().from("media_uploads").select("*").eq("id", id).maybeSingle();
      if (!up) return fail(404, "Upload not found. Start again.");
      const maxParts = Math.ceil(Number(up.size) / TUS_CHUNK);
      if (!Number.isInteger(n) || n < 0 || n >= maxParts) return fail(400, "Bad chunk.");
      const buf = await readBufferLimited(request, TUS_CHUNK);
      if (!buf) return fail(413, "This video chunk is too large.");
      const etag = await mpPart("media", id, up.upload_url, n, buf);
      await db().from("media_upload_parts").upsert({ id, n, etag }, { onConflict: "id,n" });
      return json({ ok: true });
    }
    if (a === "vdone") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- request JSON
      const body: any = await request.json().catch(() => ({}));
      const id = String(body.id || "");
      if (!ID_RE.test(id)) return fail(400, "Bad id.");
      const { data: up } = await db().from("media_uploads").select("*").eq("id", id).maybeSingle();
      if (!up) return fail(404, "Upload not found.");
      const { data: parts } = await db().from("media_upload_parts").select("n, etag").eq("id", id).order("n");
      if ((parts || []).length !== Math.ceil(Number(up.size) / TUS_CHUNK)) {
        return fail(400, "The video upload is incomplete. Please try again.");
      }
      try {
        await mpComplete("media", id, up.upload_url, (parts || []).map((p) => ({ partNumber: Number(p.n) + 1, etag: String(p.etag) })));
      } catch {
        return fail(500, "The video did not finish uploading. Please try again.");
      }
      await db().from("media_upload_parts").delete().eq("id", id);
      const row: Row = { id, name: up.name, type: up.type, size: Number(up.size), alt: "", opt: up.opt, kind: "video", at: now() };
      await db().from("media_items").insert(row);
      await db().from("media_uploads").delete().eq("id", id);
      await logAct(request, s.user, "media", "uploaded video " + up.name);
      return json({ ok: true, item: item(row) });
    }
  } catch (e) {
    console.error("media chunk error", e);
    return fail(500, e instanceof Error ? e.message : "Server error");
  }
  return mediaRequest(request);
}

// Public: GET /media/<id>
export async function serveMedia(request: Request, id: string): Promise<Response> {
  if (!ID_RE.test(id)) return new Response("Not found", { status: 404 });
  const r = await storageGet("media", id, request);
  if (!r.ok && r.status !== 206) {
    r.body?.cancel();
    return new Response("Not found", { status: 404 });
  }
  const h = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
    const v = r.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=31536000, immutable");
  h.set("x-content-type-options", "nosniff");
  if (id.endsWith(".svg")) h.set("content-security-policy", "sandbox");
  return new Response(request.method === "HEAD" ? null : r.body, { status: r.status, headers: h });
}
