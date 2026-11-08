import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withSecurityHeaders } from "./lib/security-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// Cloudflare passes variables/secrets in `env`. The backend code reads them from
// process.env, so copy them across (and create process.env if it does not exist).
function exposeEnv(env: unknown) {
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  if (!g.process) g.process = { env: {} };
  if (!g.process.env) g.process.env = {};
  if (env && typeof env === "object") {
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (typeof v === "string" && g.process.env[k] === undefined) g.process.env[k] = v;
    }
  }
}

// Set a variable DEBUG_ERRORS=1 in Cloudflare to see the real error on screen.
// Remove it again once the site works.
function errorResponse(env: unknown, err: unknown): Response {
  const debug = !!env && typeof env === "object" && (env as Record<string, unknown>)["DEBUG_ERRORS"] === "1";
  if (debug) {
    const text = err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack ?? ""}` : String(err);
    return new Response(text, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response, env: unknown): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(captured);
  return errorResponse(env, captured);
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      exposeEnv(env);
      // D1 / R2 bindings are objects, so keep the whole env for the backend.
      (globalThis as Record<string, unknown>)["__CF_ENV__"] = env;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response, env));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(errorResponse(env, error));
    }
  },
};
