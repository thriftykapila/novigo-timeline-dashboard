import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// The backend needs a same-origin proxy because it does not enable CORS.
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
  if (request.headers.authorization) {
    headers.Authorization = request.headers.authorization;
  }

  try {
    let body;
    if (request.method === "POST") {
      headers["Content-Type"] = "application/json";
      if (request.body != null) {
        body =
          typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body);
      }
    }

    const upstream = await fetch(`${backend}/${path}`, {
      method: request.method,
      headers,
      body,
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    response.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    );
    response.status(upstream.status);
    if (!upstream.body) return response.end();
    // Exact produces can exceed Vercel's 4.5 MB buffered-response limit.
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch (error) {
    // Headers already went out, so a JSON error would corrupt the partial body.
    if (response.headersSent || response.destroyed) {
      if (!response.destroyed) {
        response.destroy(error instanceof Error ? error : undefined);
      }
      return;
    }
    const timedOut = error?.name === "TimeoutError";
    const status = timedOut ? 504 : 502;
    return response.status(status).json({
      status_code: status,
      message: timedOut
        ? "The production server timed out. Please retry."
        : "The production server is unavailable. Please retry.",
      data: null,
    });
  }
}
