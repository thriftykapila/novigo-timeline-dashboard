import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, tokenStorage } from "../src/lib/api";

const envelope = (
  data: unknown,
  status = 200,
  message = "OK",
  httpStatus = status,
) =>
  new Response(
    JSON.stringify({ trace_id: "test", status_code: status, message, data }),
    { status: httpStatus, headers: { "Content-Type": "application/json" } },
  );

describe("central API client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    const entries = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
    vi.stubGlobal("window", new EventTarget());
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("unwraps login, stores the token and sends it through the common Authorization header", async () => {
    fetchMock
      .mockResolvedValueOnce(
        envelope({ access_token: "private-test-token", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(envelope({ name: "Analyst" }));
    await api.login("username", "password");
    expect(tokenStorage.get()).toBe("private-test-token");
    expect(await api.me()).toEqual({ name: "Analyst" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer private-test-token",
    );
  });
  it("expires an authenticated envelope 401 even when HTTP is 200, but keeps login rejection separate", async () => {
    tokenStorage.set("old-token");
    const expired = vi.fn();
    window.addEventListener("novigo:session-expired", expired);
    fetchMock.mockResolvedValueOnce(
      envelope(null, 401, "Session expired", 200),
    );
    await expect(api.me()).rejects.toMatchObject({
      status: 401,
      message: "Session expired",
    });
    expect(tokenStorage.get()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(envelope(null, 401, "Invalid credentials"));
    await expect(api.login("bad", "bad")).rejects.toMatchObject({
      status: 401,
      message: "Invalid credentials",
    });
    expect(expired).toHaveBeenCalledTimes(1);
  });
  it("surfaces access and field validation errors without retrying", async () => {
    fetchMock
      .mockResolvedValueOnce(envelope(null, 403, "Forbidden"))
      .mockResolvedValueOnce(
        envelope({ username: ["Required"] }, 422, "Validation error"),
      );
    await expect(api.assets()).rejects.toThrow("Access denied");
    await expect(api.shifts()).rejects.toThrow("username: Required");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retries safe analytics reads twice with backoff then exposes the final error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() =>
      Promise.resolve(envelope(null, 500, "Temporary failure")),
    );
    const pending = api
      .intervals(
        { id: "machine", name: "SPI", assetlevel_id: 10 },
        {
          from: 0,
          to: 3_600_000,
          from_ts: "2026-09-01T00:00:00Z",
          to_ts: "2026-09-01T01:00:00Z",
        },
        false,
      )
      .catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const request = fetchMock.mock.calls[0][1];
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toMatchObject({
      exact_produces: false,
      group_produce_counts_by_part_model: true,
      entity_scope: { asset: { asset_id: "machine", asset_level_id: 10 } },
    });
  });
  it("never retries login or logout and always clears the token on logout failure", async () => {
    tokenStorage.set("token");
    fetchMock.mockImplementation(() =>
      Promise.resolve(envelope(null, 500, "Temporary failure")),
    );
    await expect(api.login("a", "b")).rejects.toMatchObject({ status: 500 });
    await expect(api.logout()).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenStorage.get()).toBeNull();
  });
  it("cancels an in-flight request without retrying and supports already-aborted requests", async () => {
    fetchMock.mockImplementation(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          ),
        ),
    );
    const controller = new AbortController();
    const pending = api.me(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(api.me(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts during retry backoff instead of starting another network request", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(envelope(null, 500, "Retry me"));
    const controller = new AbortController();
    const pending = api.me(controller.signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("times out an unresponsive login and reports a useful error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          ),
        ),
    );
    const pending = api.login("a", "b").catch((error) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({
      status: 408,
      message: "The request timed out. Please try again.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not let a late 401 from an old token expire a newer session", async () => {
    tokenStorage.set("old-session");
    const expired = vi.fn();
    window.addEventListener("novigo:session-expired", expired);
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const pending = api.me().catch((error) => error);
    tokenStorage.set("new-session");
    resolveResponse(envelope(null, 401, "Old token expired"));
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(tokenStorage.get()).toBe("new-session");
    expect(expired).not.toHaveBeenCalled();
  });
  it("does not accept a late profile response after local logout", async () => {
    tokenStorage.set("old-session");
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const pending = api.me().catch((error) => error);
    tokenStorage.clear();
    resolveResponse(envelope({ name: "Previous user" }));
    expect(await pending).toMatchObject({ name: "AbortError" });
  });
  it("does not expire the session from an already-cancelled response body", async () => {
    tokenStorage.set("current-session");
    const expired = vi.fn();
    window.addEventListener("novigo:session-expired", expired);
    let resolveBody!: (value: unknown) => void;
    fetchMock.mockResolvedValue({
      status: 401,
      ok: false,
      json: () =>
        new Promise((resolve) => {
          resolveBody = resolve;
        }),
    });
    const controller = new AbortController();
    const pending = api.me(controller.signal).catch((error) => error);
    await Promise.resolve();
    controller.abort();
    resolveBody({ status_code: 401, message: "Expired", data: null });
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(tokenStorage.get()).toBe("current-session");
    expect(expired).not.toHaveBeenCalled();
  });
});
