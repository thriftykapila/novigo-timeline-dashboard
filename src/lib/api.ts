import type {
  Asset,
  CycleBucket,
  MachineIntervals,
  Shift,
  TimeWindow,
  User,
} from "./types";

const TOKEN_KEY = "novigo:access-token";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);
const TIMEOUT_MS = 30_000;

/** sessionStorage persists reloads while ending the session when the browser tab closes. */
export const tokenStorage = {
  get(): string | null {
    return typeof sessionStorage === "undefined"
      ? null
      : sessionStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    if (typeof sessionStorage !== "undefined")
      sessionStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    if (typeof sessionStorage !== "undefined")
      sessionStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function validationMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const detail = item as { msg: unknown; loc?: unknown[] };
          const location = detail.loc
            ?.filter((part) => part !== "body")
            .join(".");
          return `${location ? `${location}: ` : ""}${String(detail.msg)}`;
        }
        return validationMessage(item);
      })
      .filter(Boolean)
      .join("; ");
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, detail]) => `${key}: ${validationMessage(detail)}`)
      .join("; ");
  return "";
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request cancelled", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  authenticated?: boolean;
  retry?: boolean;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    signal,
    authenticated = true,
    retry = true,
  } = options;
  const maxRetries = retry ? 2 : 0;
  // A late response from a previous session must never expire or populate a new one.
  const token = authenticated ? tokenStorage.get() : null;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    if (authenticated && tokenStorage.get() !== token)
      throw new DOMException("Session changed", "AbortError");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      if (authenticated && tokenStorage.get() !== token)
        throw new DOMException("Session changed", "AbortError");
      const envelope =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : null;
      const envelopeStatus = Number(envelope?.status_code);
      const status = !response.ok
        ? response.status
        : envelopeStatus >= 400
          ? envelopeStatus
          : response.status;
      if (!response.ok || status >= 400) {
        if (status === 401 && authenticated) {
          tokenStorage.clear();
          if (typeof window !== "undefined")
            window.dispatchEvent(new Event("novigo:session-expired"));
        }
        const detail = envelope?.detail ?? envelope?.data;
        const message =
          status === 403
            ? "Access denied. You do not have permission to view this data."
            : status === 422
              ? validationMessage(detail) ||
                String(
                  envelope?.message || "Please check the selected filters.",
                )
              : String(
                  envelope?.message ||
                    envelope?.detail ||
                    `Request failed (${status}).`,
                );
        throw new ApiError(message, status, detail);
      }
      if (!envelope || !("data" in envelope))
        throw new ApiError(
          "The server returned an unexpected response. Please try again.",
          502,
        );
      return envelope.data as T;
    } catch (error) {
      if (signal?.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      const failure =
        error instanceof ApiError
          ? error
          : timedOut
            ? new ApiError("The request timed out. Please try again.", 408)
            : error instanceof DOMException && error.name === "AbortError"
              ? error
              : new ApiError(
                  "Unable to reach the server. Check your connection and try again.",
                  0,
                );
      const retryable =
        failure instanceof ApiError &&
        (failure.status >= 500 ||
          failure.status === 0 ||
          failure.status === 408);
      if (!retryable || attempt >= maxRetries) throw failure;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
    await wait(400 * 2 ** attempt, signal);
  }
}

const scope = (asset: Asset) => ({
  type: "asset",
  asset: { asset_id: asset.id, asset_level_id: asset.assetlevel_id },
});
const timeRange = (window: TimeWindow) => ({
  from_ts: window.from_ts,
  to_ts: window.to_ts,
});

export const api = {
  async login(username: string, password: string, signal?: AbortSignal) {
    const session = await request<{ access_token: string; token_type: string }>(
      "/auth/login",
      {
        method: "POST",
        body: { username, password },
        signal,
        authenticated: false,
        retry: false,
      },
    );
    tokenStorage.set(session.access_token);
    return session;
  },
  me: (signal?: AbortSignal) => request<User>("/auth/me", { signal }),
  async logout() {
    const token = tokenStorage.get();
    try {
      return await request<unknown>("/auth/logout", {
        method: "POST",
        retry: false,
      });
    } finally {
      if (tokenStorage.get() === token) tokenStorage.clear();
    }
  },
  assets: (signal?: AbortSignal) =>
    request<Asset[]>("/core/assets/tree", { signal }),
  shifts: (signal?: AbortSignal) =>
    request<Shift[]>("/core/shifts", { signal }),
  intervals: (
    asset: Asset,
    window: TimeWindow,
    individual: boolean,
    signal?: AbortSignal,
  ) =>
    request<MachineIntervals>("/analytics-query/machine-intervals", {
      method: "POST",
      signal,
      body: {
        entity_scope: scope(asset),
        time_range: timeRange(window),
        produce_counts: true,
        exact_produces: individual,
        group_produce_counts_by_part_model: true,
      },
    }),
  cycles: (asset: Asset, window: TimeWindow, signal?: AbortSignal) =>
    request<CycleBucket[]>("/analytics-query", {
      method: "POST",
      signal,
      body: {
        entity_scope: scope(asset),
        time_range: timeRange(window),
        metrics: ["ideal_cycle_time_seconds", "actual_cycle_time_seconds"],
        distribution: "hourly",
      },
    }),
};
