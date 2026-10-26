# Verification report

Verified on 26 October 2026 against the supplied backend, with Chromium and the local same-origin Vite transport.

## Automated checks

- `npm test`: **32 tests passed** across the API client, IST/UTC utilities, shared aggregation, and Vercel transport.
- `npm run build`: strict TypeScript and Vite production build passed.
- `npm run smoke:api`: the actual serverless handler passed all seven real backend endpoints locally (including both coarse and exact interval requests).
- Streaming transport regression: 20,000 JSON rows exceeding 4.5 MiB delivered byte-for-byte over multiple writes.
- `npm audit`: no known vulnerabilities in the installed dependency tree at verification time.

Tests include expired sessions, login rejection, bearer wiring, envelope errors, 403/422 messages, timeout, safe POST retry, cancellation during request/backoff, late-response token races, allowlisted proxy routing, overnight IST shifts, partial hours, counts across part models, null cycle metrics, invalid interval guards, future buckets, unsorted produces, FAIL preservation, and duration invariants for tiled data.

## Real backend browser checks

- Empty-form validation and rejected login display inline messages; successful login displays Analytics User.
- Default Line1 SPI, 1 September 2026, 06:00–14:30 returns 326 parts (221 PASS, 105 FAIL).
- Individual mode processes 326 produces and renders all 105 FAILs. Same-pixel PASS coalescing drew 324 markers in the live check; hourly mode uses the coarse endpoint payload.
- Hover and keyboard marker inspection expose result, produce ID and IST timestamp.
- Drag zoom, double-click reset, and visible zoom/reset controls work.
- Machine/date/shift changes refetch correctly. Overnight 23:00–06:00 on 1 September sends `2026-09-01T17:30:00Z` through `2026-09-02T00:30:00Z`.
- Reload validates `/auth/me` before restoring the dashboard. An invalid saved token redirects to `/login` with the session-expired notice.
- A future date shows an empty chart and blank future table cells. Dates with no produces can still have legitimate backend-supplied gap/downtime intervals.
- Desktop at 1440px and mobile at 375px: no page-level horizontal overflow; the wide summary table scrolls inside its own region.
- Live source overlaps and UTC-hour bucket alignment are explained in the table and [NOTES.md](NOTES.md).

## 20,000-marker performance exercise

The live service returned a smaller dataset, so the performance run uses deterministic **browser-only request interception**, isolated from the application’s real backend. Three part models, 20,000 deliberately unsorted produces, and **800 FAILs** pass through the app's normal transform/render path.

Evidence: [scripts/performance-result.json](scripts/performance-result.json).

| Check                                      | Measured result                                      |
| ------------------------------------------ | ---------------------------------------------------- |
| Initial full-shift canvas draw             | 7.1 ms                                               |
| Twelve button zoom redraws                 | 1.2–6.3 ms                                           |
| Pointer-brush redraw, 8,000 visible points | 1.9 ms, all 320 visible FAILs retained               |
| Reset to full shift                        | 6.9 ms, 20,000 points / 800 FAILs restored           |
| Hover handler                              | median 0.1 ms, p95 0.2 ms, maximum 0.3 ms            |
| Hover presentation, two animation frames   | median 16.7 ms, p95 17.6 ms                          |
| Tooltips found                             | 90 / 90; base canvas revision unchanged during hover |
| Page errors / observed >50ms long tasks    | None                                                 |

Every zoom's FAIL count is checked against actual fixture timestamps within the visible range. Markers are not merely checked at the end of the test. Keyboard inspection also verifies the first FAIL's ID and IST timestamp.

Environment: Chromium 155, 1440×1100 viewport, DPR 1, development build, this machine. Canvas draw time measures draw-command submission and preparation, not compositor completion or backend latency. The two-frame hover figure includes frame scheduling. These are local measurements, not universal performance guarantees.

### Reproduce

With `npm run dev` running:

```bash
npx --yes --package @playwright/cli playwright-cli -s=novigo-perf open http://localhost:5173
npx --yes --package @playwright/cli playwright-cli -s=novigo-perf run-code --filename scripts/performance-check.mjs
```

The script prints its measurement JSON. It creates an isolated fake session inside this browser only and intercepts API calls there; it never writes data to the backend.

## Submission links

- Repository: [thriftykapila/novigo-timeline-dashboard](https://github.com/thriftykapila/novigo-timeline-dashboard)
- Deployment: [novigo-kappa.vercel.app](https://novigo-kappa.vercel.app)

Vercel reports the deployment ready. Deployment authentication is disabled for this assignment project so reviewers can reach the app login. Local browser and serverless-handler verification is reported above; no extra HTTP smoke request was made against the deployed URL.
