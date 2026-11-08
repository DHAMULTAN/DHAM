<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- The public website and admin panel are the original single-file app in `src/legacy/site.html`, served raw by the `/` and `/$` server routes via `src/lib/backend/pages.server.ts` (which injects published content and SEO tags); keep edits to that file surgical instead of porting it to React — it is a large, working app and its API contract is what the backend implements.
- All backend endpoints (`/api/site-data`, `/api/media`, `/api/tool-data`, `/api/tool-zip`, `/media/*`, `/_tool/*`) live in `src/lib/backend/*.server.ts` and run on Cloudflare: data in D1 (binding `DB`, schema in `migrations/`, accessed through the small query builder in `d1.server.ts`) and files in R2 (binding `MEDIA`, old bucket name = key prefix); bindings reach the code via `globalThis.__CF_ENV__` set in `src/server.ts`, because the user deploys to Cloudflare from GitHub.
- Admin sign-in is the app's own username/password system (PBKDF2 hashes, roles in `admin_account_roles`, session tokens hashed in `admin_sessions`), not Cloud Auth, because the existing admin UI expects an `X-Admin-Token` header; the very first owner login comes from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` secrets.
- Uploaded tool ZIP files are served with a CSP `sandbox` header so they never run with the site's origin.
- Projects live in the published site JSON (`projs`, `projCats` with fixed ids, photos in the Photo library). A category (`projCats[]`: `id`, `name`, `slug`, `img` cover, `sum` description) is the parent of many sub-projects (`projs[]`: `id`, `title`, `slug`, `cat` = parent category id, `cover` card picture, `loc` location, `imgs` gallery of 5–8 pictures, `facts`, `body`, `pub`). Public flow: `/projects` (category cards) → `/projects/<category>` (sub-project cards) → `/projects/<category>/<project>` (3-column gallery + lightbox + details). Admin has two sections, *Project categories* and *Projects*; a sub-project opens on its own page at `/admin#project/<id>`. Older projects without `cover` fall back to their first gallery picture. Their address/SEO/cover rules exist twice — in `site.html` and `src/lib/backend/projects.server.ts` (server SEO + sitemap) — so change both together.
