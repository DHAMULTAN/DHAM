import { createFileRoute } from "@tanstack/react-router";

// The home page is the Maskan Estates single-page website, served with its published
// content and search tags already in the HTML (see src/lib/backend/pages.server.ts).
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { renderSite } = await import("@/lib/backend/pages.server");
        return renderSite(request);
      },
    },
  },
});
