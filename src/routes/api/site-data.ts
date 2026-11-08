import { createFileRoute } from "@tanstack/react-router";

// Website content + admin sign-in, team, activity log and backups.
// Admin actions are checked on the server with the X-Admin-Token session header.
export const Route = createFileRoute("/api/site-data")({
  server: {
    handlers: {
      GET: async () => {
        const { siteDataGET } = await import("@/lib/backend/site-data.server");
        return siteDataGET();
      },
      POST: async ({ request }) => {
        const { siteDataPOST } = await import("@/lib/backend/site-data.server");
        return siteDataPOST(request);
      },
    },
  },
});
