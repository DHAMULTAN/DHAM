import { createFileRoute } from "@tanstack/react-router";

// Uploading ZIP projects for tool boxes and pages (sign-in required).
export const Route = createFileRoute("/api/tool-zip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { toolZipPOST } = await import("@/lib/backend/tools.server");
        return toolZipPOST(request);
      },
    },
  },
});
