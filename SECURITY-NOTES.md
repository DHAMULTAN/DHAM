# Security review: changes and open items

## Fixed in this version
| Area | Problem | Fix |
|---|---|---|
| Sign-in | Brute force only limited per IP address; unknown usernames answered faster than wrong passwords; unlimited password length | Extra per-username lockout, equal response time for unknown users, input length caps (user 80, password 200) |
| All POST endpoints | Whole request body was read into memory before any size check (unsigned requests too) | Streaming size limits; sign-in requests max 8 KB, signed-in max ~7.5 MB, uploads max their own limits |
| Picture upload | Only the browser-supplied content type was checked | File header bytes must match the claimed picture type |
| Video upload | Chunk number/size not tied to the declared video size; incomplete uploads could be finished | Chunks bounded by declared size, all parts required before finishing, ids validated |
| Media alt/flag | Ids not validated | Validated like delete |
| Tool ZIPs | A finished upload could be finalized again (changing entry file or which paths are admin-only); unbounded admin/file lists | Finalize allowed once; admin/file lists sanitised and size-capped |
| Tool data | Any string accepted as tool name | Slug-style names only (also on backup import, max 500 entries) |
| Tool files | Admin-ticket links sent a Referer and allowed cross-origin reads | `Referrer-Policy: no-referrer`; no CORS header on ticket responses |
| Headers | No HSTS; admin panel could be framed by other sites | HSTS, nosniff, Permissions-Policy on every response; `frame-ancestors 'self'`, `base-uri`, `object-src 'none'`, `form-action 'self'` on pages |
| Exported page head | `article.cat`, `article.date`, URL were not HTML-escaped | Escaped |
| /media/ | Malformed `%` in the address caused a 500 | Returns 404 |
| Repo | `.env` files were not git-ignored | Added to `.gitignore` |
| robots.txt | /admin was crawlable | `Disallow: /admin` (page already has noindex) |

## Verified as already safe
Rich text is rebuilt from an allow-list (scripts, iframes, images, event handlers and non-http links are dropped); user values in the admin and public pages are HTML-escaped; tool/page iframes are sandboxed without same-origin access; the doc editor checks message origin; SQL is fully parameterised; passwords use salted PBKDF2; session tokens are stored hashed.

## Open items (not changed, your decision)
1. **Drafts are publicly readable.** `/api/site-data` and the page boot data contain the whole site JSON, including unpublished pages/articles/projects. Hiding them needs the admin app to load data with its token; changing it blindly could delete drafts on the next publish, so it was left alone.
2. **Tool data is public to read** (by design: "anyone can read"). Do not store private data in tool boxes.
3. **Owner/editor trust:** only the owner can change AdSense ID and custom head code (raw HTML). Keep editor accounts to people you trust; editors can still publish any page content.
4. **Lockout trade-off:** 20 wrong attempts on one username lock that username for 15 minutes, so someone can briefly lock the owner out. Raise `LOCK_MAX_USER` in `auth.server.ts` if that worries you.
5. **PBKDF2 uses 100,000 rounds**, the Workers maximum. Use a long passphrase (14+ characters).
6. **Secrets:** after the first owner login, delete `ADMIN_PASSWORD` from Cloudflare (it is ignored once the owner exists). Never leave `DEBUG_ERRORS=1` set: it shows stack traces to visitors.
7. **Dependencies** could not be audited here (no network). Run `bun audit` / `npm audit` before deploying; note `nitro` is pinned to a beta.
8. Full CSP for scripts is not enabled because the site uses inline scripts, AdSense and embeds.

---

# Cloudflare / D1 bug review

## Fixed
| Problem | Effect | Fix |
|---|---|---|
| Site content limit was 4.5 MB **characters**, but a D1 row holds about 2 MB **bytes** (Urdu/other letters take 2-3 bytes each) | Publishing a bigger site failed with a database error, or silently never saved | Limit is now measured in bytes (1.9 MB) with a clear message; same for backup import and tool data |
| Publish checked "is my copy current?" and saved in two separate steps | Two admins saving at once could overwrite each other without the conflict warning | Save is now one atomic statement (`UPDATE ... WHERE saved_at = <base>`); a stale save returns the normal "newer version" conflict |
| Cleaning up old tool ZIPs loaded every backup (up to 60 x ~2 MB) into memory | Could exceed the 128 MB Worker memory limit and fail | The database searches the text itself (`instr`), nothing is loaded |
| Every upsert ran a `PRAGMA table_info` first | Backup import used 2 queries per tool; Workers allow a limited number of D1 queries per request | Primary keys are looked up once per table and cached |
| Unfinished video uploads were never cleaned up | Upload/part records piled up forever | Records older than 24 h are removed when a new video upload starts |
| Missing indexes | Slower session, ticket and media lookups as data grows | New migration `0002_indexes.sql` |

**You must apply the new migration:** `npx wrangler d1 migrations apply <your-db-name> --remote`
(It only adds indexes; it is safe on a live database.) The SQL was tested on a real SQLite engine.

## Things I could not verify or change (check in your Cloudflare dashboard)
1. **Cloudflare Free plan limits.** Free Workers get about 10 ms of CPU per request, and sign-in hashing (PBKDF2, 100,000 rounds) plus parsing a large site JSON can exceed that (error 1102). The Workers **Paid** plan avoids this. Free also allows only 50 D1 queries per request.
2. **`wrangler.jsonc` has no `main` or `assets` entry.** This depends on how Lovable/Nitro generates the deploy output, which cannot be checked without building. If a deploy says "missing entry-point", ask Lovable to publish, or add the entry that your build prints.
3. **Replace the placeholders** `REPLACE_WITH_YOUR_D1_DATABASE_ID` and bucket `website-media` with your real D1 database ID and R2 bucket, and set the secrets `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
4. **"Full backup" is not a full copy.** The download contains site content, tool data and file lists only. Photos, videos and tool ZIP files stay in R2 and are not inside the backup file; use R2 versioning or copy the bucket for those.
5. Tests (`bun test`) and a real build could not be run here (no network). Run them once before deploying.
