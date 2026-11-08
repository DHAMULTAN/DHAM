import { describe, expect, it } from "vitest";

import {
  categoryCover,
  projectCategories,
  projectCover,
  projectPath,
  projectSitemapPaths,
} from "@/lib/backend/projects.server";

const site = {
  projCats: [
    { id: "developed", name: "Developed Projects", slug: "developed-projects" },
    { id: "upcoming", name: "Upcoming Projects", slug: "upcoming-projects" },
  ],
  projs: [
    { title: "Food Court", slug: "food-court", cat: "developed", pub: true },
    { title: "Secret Plan", slug: "secret-plan", cat: "upcoming", pub: false },
  ],
};

describe("projects", () => {
  it("puts a project page under its category address", () => {
    expect(projectPath(site, site.projs[0])).toBe("/projects/developed-projects/food-court");
  });

  it("lists published projects in the sitemap and keeps drafts out", () => {
    const paths = projectSitemapPaths(site);
    expect(paths).toContain("/projects/developed-projects/food-court");
    expect(paths).not.toContain("/projects/upcoming-projects/secret-plan");
  });

  it("gives older sites the three default categories", () => {
    expect(projectSitemapPaths({})).toEqual([
      "/projects",
      "/projects/developed-projects",
      "/projects/under-development-projects",
      "/projects/upcoming-projects",
    ]);
  });
});

describe("project and category covers", () => {
  it("uses a sub-project's own cover, and falls back to its first gallery picture for older projects", () => {
    expect(projectCover({ cover: "/media/cover", imgs: ["/media/a", "/media/b"] })).toBe("/media/cover");
    expect(projectCover({ imgs: ["", "/media/a"] })).toBe("/media/a");
    expect(projectCover({})).toBe("");
  });

  it("uses a category's own cover, else the cover of its first published sub-project", () => {
    const d = {
      projCats: [
        { id: "developed", name: "Developed", slug: "developed", img: "/media/cat", sum: "Ready communities" },
        { id: "upcoming", name: "Upcoming", slug: "upcoming" },
      ],
      projs: [
        { slug: "draft", cat: "upcoming", pub: false, cover: "/media/draft" },
        { slug: "live", cat: "upcoming", pub: true, cover: "/media/live" },
      ],
    };
    const [developed, upcoming] = projectCategories(d);
    expect(categoryCover(d, developed!)).toBe("/media/cat");
    expect(developed!.sum).toBe("Ready communities");
    expect(categoryCover(d, upcoming!)).toBe("/media/live");
    expect(upcoming!.img).toBe("");
  });
});

