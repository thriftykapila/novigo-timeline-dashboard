# Implementation notes

## Session and token management

The JSON login response supplies the bearer token. The centralized API client saves it in **sessionStorage** under `novigo:access-token`; every authenticated request reads it there and adds the Authorization header in one place.

I chose sessionStorage to keep the session across page reloads while limiting persistence to the browser tab. It is still readable by JavaScript and therefore exposed to XSS. localStorage would also survive closing the browser and retain a stolen token for longer. An HttpOnly, Secure, SameSite cookie would be preferable with a backend designed to issue cookies; this API returns a bearer token in JSON and has no cookie-based session flow. The app renders server messages as text, uses no raw HTML, and stores neither the password nor the user's profile in persistent storage.

On initial load the app calls `/auth/me` before mounting a protected dashboard. A network/server error during validation offers retry without destroying the token; a 401 clears it and redirects to `/login`. Login's own 401 stays an inline credential error. Any authenticated 401 dispatches a centralized session-expired event and clears the query cache. Token identity and session generations guard against late responses changing a newer session. Logout calls the real endpoint and clears the local session even if the server fails.

The Vercel function is a same-origin transport because direct browser requests to the supplied backend fail CORS preflight. It allowlists exactly the seven required routes and their methods, forwards the bearer header per request, disables caching, and sets a timeout. It streams upstream response bodies to avoid buffering the exact-produce payload against [Vercel’s buffered response limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), and respects Node stream backpressure. It does not retain session state. Vite provides the corresponding development proxy.

## Data fetching and state

React Context owns the small session state; TanStack Query owns server state. Query keys include the selected asset and level, complete UTC window, and exact-produce flag. Signals cancel superseded requests when filters change, so an earlier selection cannot overwrite the current chart. Metadata requests run concurrently; interval and cycle-time requests also run concurrently.

The API client unwraps the MES envelope and checks both HTTP status and envelope status. It handles 403 access denial, 422 field messages, timeouts, malformed responses, and network errors. Safe reads and read-only analytics POSTs retry twice, with 400/800 ms backoff. Login and logout are not retried. React Query retries and focus/reconnect refetches are disabled to avoid multiplying retries or introducing polling. Refresh is explicit.

The asset dropdown flattens the complete hierarchy, displaying the ancestor path in its options. Any one node may be selected with its own `id` and `assetlevel_id`; no hierarchy dashboard is built. The default uses the provided Line1 SPI machine when available. All active shift definitions are expanded from their start-time lists, including a final shift that crosses midnight.

## Chart performance

The timeline uses **two DPR-aware canvas layers**, rather than a React/SVG element for every part. The base layer draws the bands, axes, cumulative lines and markers; an overlay draws hover and range selection. Pointer movement updates refs and a single requestAnimationFrame, without rerendering the base chart or thousands of DOM nodes.

The data transform parses timestamps once, sorts unsorted individual produces, groups per-part-model cumulative counts, and supplies numeric points to the chart. Band colors and captions are resolved in memoized preparation. Rendering performs numeric coordinate projection, with no per-marker date parsing or color lookup. Hover uses a binary search over the visible time-sorted hit list and a small spatial neighborhood; only the selected tooltip timestamp is formatted.

PASS markers that occupy the same rounded canvas pixel within a model can be coalesced. **FAIL markers are never thinned**: every failure is drawn as a red cross, after the PASS markers, and remains in hit testing. A stable full-shift y scale keeps the cumulative count interpretable during zoom. Visible points are bounded with binary search; zoom has a 60-second minimum. ResizeObserver maintains sharp geometry as the layout changes.

The supplied live machine returned hundreds rather than tens of thousands of individual rows during this run. Therefore a separate, deterministic browser interception exercises **20,000 produces**, including known failures. It is isolated to the verification browser and is never shipped as a data source or substituted during the demo. See QA.md for the measured results and reproduction script. These are local measurements, not a claim about every browser/device.

The chart has drag-to-zoom, double-click reset, visible zoom/reset buttons, keyboard zoom and marker inspection, screen-reader instructions and a numeric hourly table. PASS circles and FAIL crosses make result interpretation independent of color.

## UTC, IST, and hourly bucketing

Shift clocks are interpreted explicitly with `+05:30`, independent of the viewer's computer timezone. The selected date plus the shift start/end produces UTC ISO timestamps for both analytics calls. End clocks at or before the start wrap to the following day. All displayed dates, axis ticks, tooltip timestamps, and table headings use Asia/Kolkata.

Table columns follow **IST clock hours**, including a clipped first/last hour for half-hour shift boundaries. Segments are parsed and clipped once to the selected window and the observation time; invalid, reversed, zero-length and out-of-window intervals are dropped. Chart and table consume these same normalized intervals. Each segment is cut at every IST hour boundary before its minutes are accumulated. Runtime and unplanned production are mutually exclusive categories. Planned/unplanned downtime rows appear when the API actually supplies those kinds.

Counts are summed across part models; cycle-time values come from the separate hourly metrics endpoint and nulls stay blank. Future buckets stay blank, including durations and counts; the current bucket is clipped to the observation time of the last fetch. With manual refresh only, the observation time deliberately stays at the last snapshot rather than implying continuously fresh values.

## Live backend differences and assumptions

The screenshots guide the layout, full-height colored segment bands, cumulative production line, individual-marker mode, filter card and summary table. The brief explicitly narrows the scope, so screenshot-only auto-refresh, classification actions, extra selectors and point-label settings are omitted. The written requirement specifies IST clock hours, so the table uses those rather than the screenshots' shift-relative hourly headings.

During verification of Line1 SPI on 1 September 2026:

- The API defines shift starts `06:00`, `14:30`, `23:00`; these are derived dynamically, not hard-coded.
- `produces` can be null when exact mode is off, and is treated as absent.
- **Count/metric buckets start at UTC clock hours**, which convert to IST `:30`. The interface assigns each returned coarse bucket to the IST clock hour containing `bucket_start`. The first overlapping bucket is clamped into the first visible column so requested counts are preserved. The backend does not supply enough information to divide a coarse bucket accurately between two IST clock hours. Exact marker timestamps are displayed as returned; enabling exact mode does not silently change table count semantics. A production backend should aggregate counts and metrics on the requested timezone's hour boundaries.
- **Some stoppage intervals overlap runtime**, contrary to the brief's tiled, non-overlapping guarantee. These are retained as independent supplied categories; source durations can therefore sum above 60 minutes. The app does not fabricate a precedence rule or silently subtract runtime. The chart paints source segments in chronological order and the table reports their durations. A production API should either return a non-overlapping partition or define category precedence. Well-formed tiled fixture tests verify that durations sum to each hour's elapsed length.

The dashboard displays a concise source-data note when either of these conditions occurs. No mock fallback hides a live API error.

## Scope and cuts

All required auth, filters, timeline interactions, summary rows, loading/error/retry/empty/future states are implemented. The deliberate exclusions remain excluded: classification dialogs, polling, export, settings, themes, i18n and multi-machine views. No backend database or new authentication service was introduced because the assignment supplies a real backend.

## References

Implementation checked against the [MUI v6 installation documentation](https://v6.mui.com/material-ui/getting-started/installation/) and [Vite environment-variable documentation](https://vite.dev/guide/env-and-mode). The original assignment and its fixtures remain the API contract; the discrepancies above were observed against the live service.
