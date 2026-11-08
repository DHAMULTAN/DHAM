import { createFileRoute } from "@tanstack/react-router";

// Data saved by tool boxes: anyone can read, only signed-in admins can save.
export const Route = createFileRoute("/api/tool-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { toolDataGET } = await import("@/lib/backend/tools.server");
        return toolDataGET(request);
      },
      POST: async ({ request }) => {
        const { toolDataPOST } = await import("@/lib/backend/tools.server");
        return toolDataPOST(request);
      },
    },
  },
});
