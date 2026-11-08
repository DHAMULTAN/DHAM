// Shared helpers for the website's server endpoints (runs on the server only).
import { cfEnv, sqlDb } from "./d1.server";

export const db = () => sqlDb;

export const now = () => Date.now();

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error, ...extra }, status);

export function randHex(bytes = 16): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// PBKDF2-SHA256 (100k rounds is the maximum the server runtime allows).
const ITER = 100000;
async function pbkdf2(pass: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(pass, salt, ITER);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(h)}`;
}

export async function verifyPassword(pass: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2" || !iter || !salt || !hash) return false;
  const h = await pbkdf2(pass, unb64(salt), Number(iter));
  const expected = unb64(hash);
  if (h.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h[i]! ^ expected[i]!;
  return diff === 0;
}

// Constant-time-ish string compare for configured credentials.
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function clientIp(request: Request): string {
  const raw =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0]!.trim() ||
    request.headers.get("x-real-ip") ||
    "";
  // shortened address for the activity log (privacy)
  if (raw.includes(":")) return raw.split(":").slice(0, 3).join(":") + "::";
  const p = raw.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : raw;
}

export function fullIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0]!.trim() ||
    "unknown"
  );
}

// Files live in one Cloudflare R2 bucket (binding "MEDIA"); the old bucket name becomes a key prefix.
type R2Obj = {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  range?: { offset?: number; length?: number };
};
type R2Bucket = {
  get: (k: string, o?: { range?: Headers }) => Promise<R2Obj | null>;
  head: (k: string) => Promise<R2Obj | null>;
  put: (k: string, v: unknown, o?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) => Promise<unknown>;
  delete: (k: string | string[]) => Promise<void>;
  list: (o: { prefix: string; cursor?: string | undefined; limit?: number }) => Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  createMultipartUpload: (k: string, o?: { httpMetadata?: { contentType?: string } }) => Promise<{ uploadId: string }>;
  resumeMultipartUpload: (k: string, uploadId: string) => {
    uploadPart: (n: number, v: ArrayBuffer) => Promise<{ partNumber: number; etag: string }>;
    complete: (parts: { partNumber: number; etag: string }[]) => Promise<unknown>;
  };
};

export function r2(): R2Bucket {
  const b = cfEnv()["MEDIA"] as R2Bucket | undefined;
  if (!b) throw new Error("Storage binding MEDIA is missing. Add an R2 bucket binding named MEDIA in Cloudflare.");
  return b;
}
const key = (bucket: string, path: string) => `${bucket}/${path}`;

// Streams a private file, passing Range requests through (needed for video).
export async function storageGet(bucket: string, path: string, request?: Request): Promise<Response> {
  const range = request?.headers.get("range");
  const obj = await r2().get(key(bucket, path), range ? { range: request!.headers } : undefined);
  if (!obj) return new Response("Not found", { status: 404 });
  const h = new Headers();
  h.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream");
  h.set("etag", obj.httpEtag);
  h.set("last-modified", obj.uploaded.toUTCString());
  if (range && obj.range) {
    const off = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - off;
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
    h.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers: h });
}

export async function storagePut(
  bucket: string,
  path: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType: string,
): Promise<void> {
  await r2().put(key(bucket, path), body, { httpMetadata: { contentType: contentType || "application/octet-stream" } });
}

export async function storageRemove(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 500) await r2().delete(paths.slice(i, i + 500).map((p) => key(bucket, p)));
}

// Names of files directly inside <prefix>/ (like the old storage list).
export async function storageList(bucket: string, prefix: string): Promise<string[]> {
  const base = key(bucket, prefix.replace(/\/+$/, "")) + "/";
  const out: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const r = await r2().list({ prefix: base, cursor, limit: 1000 });
    for (const o of r.objects) out.push(o.key.slice(base.length));
    if (!r.truncated) break;
    cursor = r.cursor;
  }
  return out;
}

// Large videos arrive in chunks and are stored with an R2 multipart upload.
export const TUS_CHUNK = 6 * 1024 * 1024;

export async function mpCreate(bucket: string, path: string, type: string): Promise<string> {
  const u = await r2().createMultipartUpload(key(bucket, path), { httpMetadata: { contentType: type } });
  return u.uploadId;
}

export async function mpPart(bucket: string, path: string, uploadId: string, n: number, body: ArrayBuffer) {
  const p = await r2().resumeMultipartUpload(key(bucket, path), uploadId).uploadPart(n + 1, body);
  return p.etag;
}

export async function mpComplete(bucket: string, path: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
  await r2().resumeMultipartUpload(key(bucket, path), uploadId).complete(parts);
}

export const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  wasm: "application/wasm",
  zip: "application/zip",
};

export function mimeFor(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return MIME[ext] || "text/plain; charset=utf-8";
}

// ---------- request body limits ----------
// Reads a request body but gives up (returns null) as soon as it grows past `max` bytes,
// so nobody can make the server buffer a huge upload. Checks Content-Length first.
export async function readBufferLimited(request: Request, max: number): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

export async function readTextLimited(request: Request, max: number): Promise<string | null> {
  const buf = await readBufferLimited(request, max);
  return buf ? new TextDecoder().decode(buf) : null;
}

// Names under which tool boxes store their data (slug-like).
export const TOOL_KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;

export const tooLarge = (what = "This request") => fail(413, `${what} is too large.`);

// ---------- upload content checks ----------
// Confirms the first bytes of a file really look like the picture type it claims to be.
export function looksLikeImage(type: string, buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 64));
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && at(1, "PNG");
    case "image/gif":
      return at(0, "GIF8");
    case "image/webp":
      return at(0, "RIFF") && at(8, "WEBP");
    case "image/avif":
      return at(4, "ftyp") && (at(8, "avif") || at(8, "avis") || at(8, "mif1"));
    case "image/svg+xml": {
      const head = new TextDecoder().decode(b).replace(/^\uFEFF/, "").trimStart().toLowerCase();
      return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg");
    }
    default:
      return false;
  }
}
