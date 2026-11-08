import { createFileRoute } from "@tanstack/react-router";

// Admin photo & video library (sign-in required for every action).
export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { mediaRequest } = await import("@/lib/backend/media.server");
        return mediaRequest(request);
      },
      POST: async ({ request }) => {
        const { mediaChunk } = await import("@/lib/backend/media.server");
        return mediaChunk(request);
      },
    },
  },
});
