import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Same-origin transport for the assignment backend, which does not enable CORS.
 * Only the seven assignment endpoints are forwarded; tokens stay in the request.
 */
export const allowedRoutes = {
  "auth/login": "POST",
  "auth/me": "GET",
  "auth/logout": "POST",
  "core/assets/tree": "GET",
  "core/shifts": "GET",
  "analytics-query/machine-intervals": "POST",
  "analytics-query": "POST",
};

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const requestedPath = request.query.path;
  const path = Array.isArray(requestedPath)
    ? requestedPath.join("/")
    : requestedPath;
  if (!path || !Object.hasOwn(allowedRoutes, path)) {
    return response
      .status(404)
      .json({ status_code: 404, message: "Endpoint not found.", data: null });
  }
  if (request.method !== allowedRoutes[path]) {
    response.setHeader("Allow", allowedRoutes[path]);
    return response
      .status(405)
      .json({ status_code: 405, message: "Method not allowed.", data: null });
  }
  const backend = (
    process.env.BACKEND_BASE_URL || "https://13.207.251.55.nip.io"
  ).replace(/\/$/, "");
  const headers = { Accept: "application/json" };
  if (request.headers.authorization)
    headers.Authorization = request.headers.authorization;
  if (request.method === "POST") headers["Content-Type"] = "application/json";
  try {
    const upstream = await fetch(`${backend}/${path}`, {
      method: request.method,
      headers,
      ...(request.method === "POST" && request.body != null
        ? {
            body:
              typeof request.body === "string"
                ? request.body
                : JSON.stringify(request.body),
          }
        : {}),
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    response.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    );
    response.status(upstream.status);
    if (!upstream.body) return response.end();
    // Stream with backpressure: exact produces can exceed Vercel's 4.5 MB
    // buffered-response limit. Do not collect the payload with text()/json().
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch (error) {
    // A broken stream must terminate the connection. Appending a JSON error to
    // an already-started JSON payload would corrupt the response further.
    if (response.headersSent || response.destroyed) {
      if (!response.destroyed)
        response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const timeout = error?.name === "TimeoutError";
    return response.status(timeout ? 504 : 502).json({
      status_code: timeout ? 504 : 502,
      message: timeout
        ? "The production server timed out. Please retry."
        : "The production server is unavailable. Please retry.",
      data: null,
    });
  }
}
