// Serves the website's single-page app with its published content and search-engine tags
// already inside the HTML, so visitors and Google see the right page immediately.
import siteHtml from "@/legacy/site.html?raw";
import { categoryCover, projectCategories, projectCover, projectSitemapPaths, publishedProjects } from "./projects.server";
import { readSite } from "./site-data.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form site JSON
type Json = any;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const plain = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_>`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

function absImg(u: unknown, origin: string): string {
  const s = String(u || "");
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith("/")) return origin + s;
  return "";
}

type Meta = { title: string; desc: string; type?: string | undefined; img?: string | undefined; robots?: string | undefined };

function pageMeta(d: Json, path: string, origin: string): Meta {
  const title = String(d.title || "Maskan Estates");
  const seo = (d.seo || {}) as Json;
  const tpl = (t: string) => String(seo.tpl || "%page% | %site%").replace("%page%", t).replace("%site%", title);
  const def: Meta = { title, desc: String(seo.desc || ""), img: absImg(seo.og, origin) };
  const segs = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (segs[0] === "admin") return { title: "Admin | " + title, desc: "", robots: "noindex,nofollow" };
  if (!segs.length) return def;
  const [a, b] = segs;
  if (a === "newsflash" && b) {
    const art = (d.arts || []).find((x: Json) => x.slug === b);
    if (art) return { title: tpl(art.title), desc: String(art.sum || def.desc), type: "article", img: absImg(art.img, origin) || def.img };
  }
  if (a === "newsflash") return { ...def, title: tpl("Newsflash"), desc: `Latest property notices and updates summarised by ${title}.` };
  if (a === "projects") {
    const p = segs[2] ? publishedProjects(d).find((x: Json) => x.slug === segs[2]) : null;
    if (p) {
      const desc = (String(p.sum || "").trim() || plain(p.body)).slice(0, 155) || def.desc;
      return { title: tpl(p.title), desc, img: absImg(projectCover(p), origin) || def.img };
    }
    const c = b ? projectCategories(d).find((x) => x.slug === b) : null;
    if (c) {
      return {
        ...def,
        title: tpl(c.name),
        desc: c.sum.trim() || `${c.name} by ${title}: photos and details of each project.`,
        img: absImg(categoryCover(d, c), origin) || def.img,
      };
    }
    return { ...def, title: tpl("Projects"), desc: `Projects by ${title}: photos and details, grouped by category.` };
  }
  if (a === "videos" && b) {
    const v = (d.vids || []).find((x: Json) => x.slug === b);
    if (v) return { title: tpl(v.title), desc: plain(v.desc).slice(0, 155) || def.desc, type: "video.other", img: absImg(v.thumb, origin) || def.img };
  }
  if (a === "videos") return { ...def, title: tpl("Videos"), desc: `Watch ${title} videos, played from our official channels.` };
  if (a === "gallery") return { ...def, title: tpl("Gallery"), desc: `Photo gallery from ${title}.` };
  if (a === "doc") return { ...def, title: tpl("Documents"), desc: `Property checklists and document templates from ${title}.` };
  if (a === "featured" && b) {
    const f = (d.slides || []).find((x: Json) => x.slug === b);
    if (f) return { title: tpl(f.t), desc: plain(f.s || f.body).slice(0, 155) || def.desc, img: absImg(f.img, origin) || def.img };
  }
  if (a === "tools" && b) {
    const t = (d.boxes || []).find((x: Json) => slugify(String(x.title || "")) === b);
    if (t) return { ...def, title: tpl(t.title), desc: String(t.dis || def.desc) };
  }
  const pg = (d.pages || []).find((x: Json) => x.slug === a && x.pub);
  if (pg) return { ...def, title: tpl(pg.title), desc: plain(pg.body).slice(0, 155) || def.desc };
  return def;
}

function seoHead(d: Json, path: string, origin: string): string {
  const m = pageMeta(d, path, origin);
  const seo = (d.seo || {}) as Json;
  const url = origin + path;
  const isAdmin = m.robots === "noindex,nofollow";
  const out = [
    `<meta name="robots" content="${m.robots || "index,follow,max-image-preview:large"}">`,
    `<meta property="og:site_name" content="${esc(d.title)}">`,
    `<meta property="og:type" content="${m.type || "website"}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    m.img ? `<meta property="og:image" content="${esc(m.img)}">` : "",
    `<meta name="twitter:card" content="${m.img ? "summary_large_image" : "summary"}">`,
  ];
  if (!isAdmin) {
    out.push(`<link rel="canonical" href="${esc(url)}">`);
    if (/^ca-pub-\d{10,20}$/.test(String(seo.ads || ""))) {
      out.push(
        `<script id="adsbygoogle-js" async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(seo.ads)}" crossorigin="anonymous"></script>`,
      );
    }
    if (typeof seo.head === "string" && seo.head.trim()) out.push(seo.head);
  }
  return out.filter(Boolean).join("\n");
}

const DEFAULT_TAGS =
  '<meta name="robots" content="index,follow,max-image-preview:large">\n<meta property="og:type" content="website">\n<meta property="og:title" content="Maskan Estates">\n<meta property="og:description" content="Property listings, calculators and Newsflash updates for plot owners and buyers in Pakistan.">\n<meta name="twitter:card" content="summary">';

export async function renderSite(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;
  let html = siteHtml;
  let site: Awaited<ReturnType<typeof readSite>> = null;
  try {
    site = await readSite();
  } catch (e) {
    console.error("could not read site data", e);
  }
  const isAdmin = path === "/admin" || path.startsWith("/admin/");

  html = html.replace("</title>", '</title>\n<link rel="icon" type="image/png" href="/favicon.png">');
  if (site?.data) {
    const m = pageMeta(site.data, path, origin);
    html = html
      .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(m.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(m.desc)}">`)
      .replace("<!--SEO-HEAD-->", () => seoHead(site!.data, path, origin));
    const boot = JSON.stringify({ data: site.data, savedAt: site.savedAt })
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    html = html.replace("<!--SITE-DATA-->", () => `<script id="site-boot" type="application/json">${boot}</script>`);
  } else {
    html = html.replace("<!--SEO-HEAD-->", isAdmin ? '<meta name="robots" content="noindex,nofollow">' : DEFAULT_TAGS);
  }

  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    // Blocks clickjacking (the admin panel cannot be framed by other sites) and <base>/<object>/form
    // hijacking. Scripts and styles are intentionally not restricted: the site relies on inline code,
    // Google Fonts, AdSense and video embeds.
    "content-security-policy": "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'",
    "x-frame-options": "SAMEORIGIN",
  };
  if (isAdmin) headers["x-robots-tag"] = "noindex, nofollow";
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
}

export async function renderSitemap(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const site = await readSite().catch(() => null);
  const d = (site?.data || {}) as Json;
  const paths = new Set<string>(["/", "/newsflash", "/doc", "/videos", "/gallery"]);
  for (const p of d.pages || []) if (p.pub && p.kind !== "link" && p.slug) paths.add("/" + p.slug);
  for (const b of d.boxes || []) if (b.title) paths.add("/tools/" + slugify(String(b.title)));
  for (const a of d.arts || []) if (a.pub && a.slug) paths.add("/newsflash/" + a.slug);
  for (const v of d.vids || []) if (v.pub && v.slug) paths.add("/videos/" + v.slug);
  for (const p of projectSitemapPaths(d)) paths.add(p);
  for (const f of d.slides || []) if ((f.lk || "page") === "page" && f.slug) paths.add("/featured/" + f.slug);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...paths].map((p) => `  <url><loc>${esc(origin + p)}</loc></url>`).join("\n") +
    "\n</urlset>\n";
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}
