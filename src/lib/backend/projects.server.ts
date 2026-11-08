// Projects (admin → Projects): page addresses and search-engine text for
// /projects, /projects/<category> and /projects/<category>/<project>.
// Must match the website's own rules in src/legacy/site.html (projPath, pubProjs, PROJ_CATS_DEF, projCover, catCover).

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form site JSON
type Json = any;

export type ProjectCategory = { id: string; name: string; slug: string; img: string; sum: string };

export const DEFAULT_PROJECT_CATEGORIES: ProjectCategory[] = [
  { id: "developed", name: "Developed Projects", slug: "developed-projects", img: "", sum: "" },
  { id: "under-development", name: "Under-Development Projects", slug: "under-development-projects", img: "", sum: "" },
  { id: "upcoming", name: "Upcoming Projects", slug: "upcoming-projects", img: "", sum: "" },
];

/** Sites saved before Projects existed have no categories yet: they get the three defaults. */
export function projectCategories(d: Json): ProjectCategory[] {
  if (!Array.isArray(d?.projCats)) return DEFAULT_PROJECT_CATEGORIES;
  return (d.projCats as Json[])
    .filter((c) => c && typeof c === "object" && c.slug)
    .map((c) => ({
      id: String(c.id || c.slug),
      name: String(c.name || ""),
      slug: String(c.slug),
      img: typeof c.img === "string" ? c.img : "",
      sum: typeof c.sum === "string" ? c.sum : "",
    }));
}

/** Only published projects with a page address are visible to visitors. */
export function publishedProjects(d: Json): Json[] {
  return (Array.isArray(d?.projs) ? d.projs : []).filter((p: Json) => p && p.pub && p.slug);
}

/** A sub-project's card picture: its own cover, else (older projects) its first gallery picture. */
export function projectCover(p: Json): string {
  const first = Array.isArray(p?.imgs) ? (p.imgs as Json[]).find((u) => typeof u === "string" && u) : "";
  return String((typeof p?.cover === "string" && p.cover) || first || "");
}

/** A category card picture: its own cover, else the cover of its first published sub-project. */
export function categoryCover(d: Json, c: ProjectCategory): string {
  if (c.img) return c.img;
  const first = publishedProjects(d).find((p: Json) => p.cat === c.id);
  return first ? projectCover(first) : "";
}

export function projectPath(d: Json, p: Json): string {
  const c = projectCategories(d).find((x) => x.id === p.cat);
  return "/projects/" + (c ? c.slug : "other") + "/" + p.slug;
}

/** Addresses for the sitemap: the projects page, every category page and every published project. */
export function projectSitemapPaths(d: Json): string[] {
  return [
    "/projects",
    ...projectCategories(d).map((c) => "/projects/" + c.slug),
    ...publishedProjects(d).map((p) => projectPath(d, p)),
  ];
}
