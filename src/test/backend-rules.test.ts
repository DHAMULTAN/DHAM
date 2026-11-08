import { describe, expect, it } from "vitest";

import { sameSeoOwnerFields } from "@/lib/backend/site-data.server";
import { hashPassword, verifyPassword } from "@/lib/backend/util.server";

describe("admin passwords", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong password!!", stored)).toBe(false);
  });
});

describe("owner-only SEO fields", () => {
  it("treats a changed AdSense ID or custom head code as an owner-only change", () => {
    const cur = { seo: { ads: "ca-pub-1234567890", head: "<meta x>", desc: "a" } };
    expect(sameSeoOwnerFields(cur, { seo: { ads: "ca-pub-1234567890", head: "<meta x>", desc: "b" } })).toBe(true);
    expect(sameSeoOwnerFields(cur, { seo: { ads: "ca-pub-9999999999", head: "<meta x>" } })).toBe(false);
    expect(sameSeoOwnerFields(cur, { seo: { ads: "ca-pub-1234567890", head: "<script>" } })).toBe(false);
  });
});

import { looksLikeImage, readBufferLimited, readTextLimited } from "@/lib/backend/util.server";
import { withSecurityHeaders } from "@/lib/security-headers";

const bytes = (...n: number[]) => new Uint8Array(n).buffer;
const ascii = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("upload content checks", () => {
  it("accepts real picture headers and rejects mismatches", () => {
    expect(looksLikeImage("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe(true);
    expect(looksLikeImage("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(looksLikeImage("image/gif", ascii("GIF89a"))).toBe(true);
    expect(looksLikeImage("image/webp", ascii("RIFF\0\0\0\0WEBP"))).toBe(true);
    expect(looksLikeImage("image/svg+xml", ascii("  <svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(true);
    expect(looksLikeImage("image/png", ascii("<html><script>alert(1)</script>"))).toBe(false);
    expect(looksLikeImage("image/jpeg", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(looksLikeImage("application/pdf", ascii("%PDF"))).toBe(false);
  });
});

describe("request body limits", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://example.test/x", { method: "POST", body, headers });
  it("reads bodies that fit", async () => {
    expect(await readTextLimited(req("hello"), 10)).toBe("hello");
  });
  it("refuses bodies over the limit", async () => {
    expect(await readTextLimited(req("x".repeat(50)), 10)).toBeNull();
    expect((await readBufferLimited(req("x".repeat(50)), 10)) === null).toBe(true);
  });
  it("refuses early when Content-Length already exceeds the limit", async () => {
    expect(await readTextLimited(req("hi", { "content-length": "999999" }), 10)).toBeNull();
  });
});

describe("security headers", () => {
  it("adds missing headers and keeps existing ones", () => {
    const r = withSecurityHeaders(new Response("ok", { headers: { "referrer-policy": "no-referrer" } }));
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
