import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/proxy.js";

function createResponse(slow = false) {
  const chunks: Buffer[] = [];
  let headersSent = false;
  const stream = new Writable({
    highWaterMark: 1024,
    write(chunk, _encoding, callback) {
      headersSent = true;
      chunks.push(Buffer.from(chunk));
      if (slow) setImmediate(callback);
      else callback();
    },
  });
  Object.defineProperty(stream, "headersSent", { get: () => headersSent });
  return Object.assign(stream, {
    chunks,
    statusCode: 200,
    setHeader: vi.fn(),
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: Writable, value: unknown) {
      this.end(JSON.stringify(value));
      return this;
    }),
    body: () => Buffer.concat(chunks).toString(),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("same-origin production transport", () => {
  it("forwards only known endpoint/method pairs and carries bearer authorization", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status_code: 200, data: { name: "Operator" } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const res = createResponse();
    await handler(
      {
        query: { path: "auth/me" },
        method: "GET",
        headers: { authorization: "Bearer test-session" },
      },
      res,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://13.207.251.55.nip.io/auth/me",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer test-session",
        },
        redirect: "error",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(JSON.parse(res.body()).data).toEqual({ name: "Operator" });
  });

  it("rejects arbitrary destinations and disallowed methods without making requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const [path, method, status] of [
      ["https://other.example/auth/login", "GET", 404],
      ["../auth/login", "POST", 404],
      ["auth/login", "GET", 405],
    ] as const) {
      const res = createResponse();
      await handler({ query: { path }, method, headers: {} }, res);
      expect(res.status).toHaveBeenCalledWith(status);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves upstream rejection status and JSON payload", async () => {
    const payload = '{"status_code":401,"message":"Expired","data":null}';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(payload, { status: 401 })),
    );
    const res = createResponse();
    await handler(
      {
        query: { path: ["analytics-query"] },
        method: "POST",
        headers: {},
        body: { distribution: "hourly" },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body()).toBe(payload);
  });

  it("returns a retryable JSON error when upstream is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network unavailable")),
    );
    const res = createResponse();
    await handler(
      { query: { path: "core/shifts" }, method: "GET", headers: {} },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status_code: 502 }),
    );
  });

  it("serializes analytics JSON and supports path segments supplied by the rewrite", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"status_code":200,"data":{}}', { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    const body = {
      entity_scope: {
        type: "asset",
        asset: { asset_id: "machine", asset_level_id: 10 },
      },
      exact_produces: true,
    };
    const res = createResponse();
    await handler(
      {
        query: { path: ["analytics-query", "machine-intervals"] },
        method: "POST",
        headers: { authorization: "Bearer test-session" },
        body,
      },
      res,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://13.207.251.55.nip.io/analytics-query/machine-intervals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          Accept: "application/json",
          Authorization: "Bearer test-session",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("returns a JSON 504 when the upstream deadline expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("Upstream deadline", "TimeoutError"),
        ),
    );
    const res = createResponse();
    await handler(
      { query: { path: "core/shifts" }, method: "GET", headers: {} },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status_code: 504,
        message: "The production server timed out. Please retry.",
      }),
    );
  });

  it("streams a 20,000-produce response larger than 4.5 MB across multiple writes without buffering upstream", async () => {
    const payload = JSON.stringify({
      status_code: 200,
      data: {
        produces: Array.from({ length: 20_000 }, (_, index) => ({
          produce_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
          first_seen_ts: "2026-09-01T00:30:45Z",
          result: index % 20 === 0 ? "FAIL" : "PASS",
          quantity: 1,
          machine_id: 200,
          produce_type: "FIRST",
          part_model_id: "00000000-0000-0000-0000-000000000000",
          bucket_start: "2026-09-01T00:00:00Z",
        })),
      },
    });
    const bytes = new TextEncoder().encode(payload);
    expect(bytes.byteLength).toBeGreaterThan(4.5 * 1024 * 1024);
    let offset = 0;
    const upstream = new Response(
      new ReadableStream({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + 64 * 1024));
          offset += 64 * 1024;
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    const text = vi.spyOn(upstream, "text");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
    const res = createResponse(true);
    await handler(
      {
        query: { path: "analytics-query/machine-intervals" },
        method: "POST",
        headers: {},
        body: { exact_produces: true },
      },
      res,
    );
    expect(text).not.toHaveBeenCalled();
    expect(res.chunks.length).toBeGreaterThan(1);
    expect(res.writableFinished).toBe(true);
    expect(Buffer.concat(res.chunks).equals(Buffer.from(bytes))).toBe(true);
    expect(JSON.parse(res.body()).data.produces).toHaveLength(20_000);
  });

  it("ends a bodyless upstream response without attempting a stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    const res = createResponse();
    await handler(
      { query: { path: "auth/logout" }, method: "POST", headers: {} },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.body()).toBe("");
    expect(res.writableEnded).toBe(true);
  });

  it("destroys a failed stream without appending an error envelope after headers", async () => {
    let first = true;
    const upstream = new Response(
      new ReadableStream({
        async pull(controller) {
          if (first) {
            first = false;
            controller.enqueue(
              new TextEncoder().encode('{"status_code":200,"data":'),
            );
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.error(new Error("upstream stream broke"));
        },
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
    const res = createResponse();
    await handler(
      { query: { path: "core/shifts" }, method: "GET", headers: {} },
      res,
    );
    expect(res.destroyed).toBe(true);
    expect(res.json).not.toHaveBeenCalled();
    expect(res.body()).toBe('{"status_code":200,"data":');
  });
});
