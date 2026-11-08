import { createFileRoute } from "@tanstack/react-router";

// Every other address: photo/video files (/media/...), uploaded tool ZIP files (/_tool/...),
// the sitemap, and otherwise the website itself (it reads the address and shows the right page).
async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/media/")) {
    const { serveMedia } = await import("@/lib/backend/media.server");
    let id: string;
    try {
      id = decodeURIComponent(path.slice(7));
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return serveMedia(request, id);
  }
  if (path.startsWith("/_tool/")) {
    const { serveTool } = await import("@/lib/backend/tools.server");
    return serveTool(request, path.slice(7));
  }
  if (path === "/sitemap.xml") {
    const { renderSitemap } = await import("@/lib/backend/pages.server");
    return renderSitemap(request);
  }
  if (path === "/app.html" || path === "/index.html") {
    return Response.redirect(new URL("/", request.url).toString(), 301);
  }
  const { renderSite } = await import("@/lib/backend/pages.server");
  return renderSite(request);
}

export const Route = createFileRoute("/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
