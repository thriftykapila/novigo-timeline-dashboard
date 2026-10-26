// Browser-only, deterministic stress fixture. It does not modify the app or the backend.
// Start the app with `npm run dev`, then run:
// bash ~/.codex/skills/playwright/scripts/playwright_cli.sh -s=novigo-perf open http://localhost:5173
// bash ~/.codex/skills/playwright/scripts/playwright_cli.sh -s=novigo-perf run-code --filename scripts/performance-check.mjs
// The CLI prints the JSON result; the checked-in measurement is scripts/performance-result.json.
async (page) => {
  const baseURL = "http://localhost:5173";
  const markerCount = 20_000;
  const failureEvery = 25;
  const expectedFailures = markerCount / failureEvery;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(
    ({ origin }) => {
      if (location.origin !== origin) return;
      sessionStorage.setItem(
        "novigo:access-token",
        "isolated-browser-performance-fixture",
      );
      window.__novigoPerformance = { longTasks: [] };
      if (typeof PerformanceObserver !== "undefined") {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              window.__novigoPerformance.longTasks.push({
                start: entry.startTime,
                duration: entry.duration,
              });
          }).observe({ type: "longtask", buffered: true });
        } catch {
          /* Long Tasks API is browser-dependent. */
        }
      }
    },
    { origin: new URL(baseURL).origin },
  );
  const envelope = (data) => ({
    trace_id: "deterministic-performance-fixture",
    status_code: 200,
    message: "OK",
    data,
  });
  let fixtureTimes = [];
  let fixtureWindow = null;
  const makeIntervals = (body) => {
    const from = Date.parse(body.time_range.from_ts);
    const to = Date.parse(body.time_range.to_ts);
    fixtureWindow = { from, to };
    const groups = new Map();
    fixtureTimes = [];
    for (let index = 0; index < markerCount; index++) {
      const time =
        from + 1000 + (index * (to - from - 2000)) / (markerCount - 1);
      fixtureTimes.push(time);
      const bucketTime =
        Math.floor((time + 19_800_000) / 3_600_000) * 3_600_000 - 19_800_000;
      const bucketStart = new Date(bucketTime).toISOString();
      const partModel = ["D22", "D23", "D24"][index % 3];
      const key = `${bucketStart}:${partModel}`;
      if (!groups.has(key))
        groups.set(key, {
          bucket_start: bucketStart,
          part_model_id: partModel,
          ok_count: 0,
          ng_count: 0,
          produces: [],
        });
      const group = groups.get(key);
      const result = index % failureEvery === 0 ? "FAIL" : "PASS";
      if (result === "FAIL") group.ng_count++;
      else group.ok_count++;
      group.produces.push({
        produce_id: `performance-part-${String(index).padStart(5, "0")}`,
        first_seen_ts: new Date(time).toISOString(),
        result,
        produce_type: "FIRST",
        part_model_id: partModel,
      });
    }
    const segment = (a, b, type, name, field) => ({
      start_at: new Date(from + (to - from) * a).toISOString(),
      end_at: new Date(from + (to - from) * b).toISOString(),
      type,
      [field]: name,
    });
    const buckets = [...groups.values()];
    return {
      machine_ids: ["isolated-performance-machine"],
      runtimes: [
        segment(0, 0.125, "planned", null, "runtime_name"),
        segment(0.14, 0.45, "planned", null, "runtime_name"),
        segment(0.5, 0.78, "planned", null, "runtime_name"),
        segment(
          0.79,
          0.82,
          "unknown unplanned production",
          null,
          "runtime_name",
        ),
        segment(0.82, 1, "planned", null, "runtime_name"),
      ],
      downtimes: [
        segment(0.125, 0.14, "unknown", "unknown", "downtime_name"),
        segment(0.45, 0.5, "planned", "Lunch break", "downtime_name"),
      ],
      stoppages: [
        segment(0.78, 0.79, "stoppage", "Minor stoppage", "stoppage_name"),
      ],
      produce_counts: buckets.map(
        ({ bucket_start, part_model_id, ok_count, ng_count }) => ({
          bucket_start,
          part_model_id,
          ok_count,
          ng_count,
        }),
      ),
      // Deliberately reverse both bucket and row order to exercise the real flatten/sort pipeline.
      ...(body.exact_produces
        ? {
            produces: buckets
              .map(({ bucket_start, part_model_id, produces }) => ({
                bucket_start,
                part_model_id,
                produces: produces.reverse(),
              }))
              .reverse(),
          }
        : {}),
    };
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api(?=\/)/, "");
    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
    };
    if (
      request.method() === "OPTIONS" &&
      /\/(auth|core|analytics-query)/.test(path)
    )
      return route.fulfill({ status: 204, headers });
    let data;
    if (path === "/auth/me")
      data = {
        id: "isolated-fixture-user",
        username: "performance-check",
        name: "Isolated performance test",
        email: "performance@example.invalid",
        roles: ["Analytics"],
        customer_name: "Deterministic test fixture",
      };
    else if (path === "/core/assets/tree")
      data = [
        {
          id: "isolated-performance-machine",
          name: "Performance fixture · 20,000 markers",
          assetlevel_id: 10,
          children: [],
        },
      ];
    else if (path === "/core/shifts")
      data = [
        {
          id: "isolated-shift",
          code: "main",
          name: "main",
          shift_timings: ["00:30", "12:30"],
          is_active: true,
        },
      ];
    else if (path === "/analytics-query/machine-intervals")
      data = makeIntervals(request.postDataJSON());
    else if (path === "/analytics-query") data = [];
    else return route.continue();
    return route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify(envelope(data)),
    });
  });
  await page.goto(`${baseURL}/dashboard`);
  await page.getByTestId("timeline-canvas").waitFor();
  await page
    .getByRole("checkbox", { name: "Show individual produces" })
    .check();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="timeline-canvas"]')?.dataset
        .visibleMarkers === "20000",
  );
  const canvas = page.getByTestId("timeline-canvas");
  const readCanvas = () =>
    canvas.evaluate((element) => ({
      drawMs: Number(element.dataset.renderMs),
      visibleMarkers: Number(element.dataset.visibleMarkers),
      renderedMarkers: Number(element.dataset.markersRendered),
      failMarkers: Number(element.dataset.failureMarkers),
      cssWidth: element.clientWidth,
      cssHeight: element.clientHeight,
      backingWidth: element.width,
      backingHeight: element.height,
      viewFrom: Number(element.dataset.viewFrom),
      viewTo: Number(element.dataset.viewTo),
      drawRevision: Number(element.dataset.drawRevision),
    }));
  const assertFailures = (measurement) => {
    let expected = 0;
    for (let index = 0; index < fixtureTimes.length; index += failureEvery) {
      if (
        fixtureTimes[index] >= measurement.viewFrom &&
        fixtureTimes[index] <= measurement.viewTo
      )
        expected++;
    }
    if (measurement.failMarkers !== expected)
      throw new Error(
        `Visible FAIL mismatch: expected ${expected}, got ${measurement.failMarkers}`,
      );
    return expected;
  };
  const initial = await readCanvas();
  if (
    initial.visibleMarkers !== markerCount ||
    initial.failMarkers !== expectedFailures
  )
    throw new Error(
      `Expected 20,000 markers and 800 FAILs, got ${JSON.stringify(initial)}`,
    );
  const samples = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const name of ["Zoom in", "Zoom in", "Zoom out", "Zoom out"]) {
      const before = await readCanvas();
      const started = Date.now();
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForFunction(
        (previous) =>
          Number(
            document.querySelector('[data-testid="timeline-canvas"]')?.dataset
              .visibleMarkers,
          ) !== previous,
        before.visibleMarkers,
      );
      const after = await readCanvas();
      const expectedFailMarkers = assertFailures(after);
      const selected = await page
        .locator(".timeline-interaction")
        .getAttribute("aria-describedby");
      const summary = await page
        .locator(`[id="${selected.split(" ")[1]}"]`)
        .textContent();
      samples.push({
        iteration,
        action: name,
        playwrightActionMs: Date.now() - started,
        ...after,
        expectedFailMarkers,
        accessibleSummary: summary,
      });
    }
  }
  const final = await readCanvas();
  if (
    final.visibleMarkers !== markerCount ||
    final.failMarkers !== expectedFailures
  )
    throw new Error("Reset zoom lost markers or FAILs.");
  // Browser-side timings avoid counting the Playwright transport in hover response measurements.
  const hover = await page.evaluate(
    async ({ times, from, to }) => {
      const target = document.querySelector(".timeline-interaction");
      const base = document.querySelector('[data-testid="timeline-canvas"]');
      const bounds = target.getBoundingClientRect();
      const left = bounds.width < 540 ? 44 : 58;
      const right = bounds.width - 17;
      const top = 31;
      const bottom = bounds.height - 49;
      const maxY = 7500;
      const revisionBefore = base.dataset.drawRevision;
      const latencies = [];
      const handlerTimes = [];
      let visibleTooltips = 0;
      for (let iteration = 0; iteration < 90; iteration++) {
        const index = Math.min(19999, 250 + iteration * 211);
        const x = left + ((times[index] - from) / (to - from)) * (right - left);
        const y =
          bottom - ((Math.floor(index / 3) + 1) / maxY) * (bottom - top);
        const started = performance.now();
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: bounds.left + x,
            clientY: bounds.top + y,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        latencies.push(performance.now() - started);
        handlerTimes.push(Number(target.dataset.hoverMs));
        if (!document.querySelector(".timeline-tooltip").hidden)
          visibleTooltips++;
      }
      latencies.sort((a, b) => a - b);
      handlerTimes.sort((a, b) => a - b);
      return {
        samples: latencies.length,
        minMs: latencies[0],
        medianMs: latencies[Math.floor(latencies.length / 2)],
        p95Ms: latencies[Math.floor(latencies.length * 0.95)],
        maxMs: latencies[latencies.length - 1],
        handlerMedianMs: handlerTimes[Math.floor(handlerTimes.length / 2)],
        handlerP95Ms: handlerTimes[Math.floor(handlerTimes.length * 0.95)],
        handlerMaxMs: handlerTimes[handlerTimes.length - 1],
        visibleTooltips,
        baseCanvasUnchanged: base.dataset.drawRevision === revisionBefore,
      };
    },
    { times: fixtureTimes, ...fixtureWindow },
  );
  if (!hover.baseCanvasUnchanged || hover.visibleTooltips !== hover.samples)
    throw new Error(`Hover failed: ${JSON.stringify(hover)}`);
  await page.locator(".timeline-interaction").focus();
  await page.keyboard.press("ArrowRight");
  const keyboardTooltip = await page.locator(".timeline-tooltip").innerText();
  if (
    !keyboardTooltip.includes("FAIL") ||
    !keyboardTooltip.includes("IST") ||
    !keyboardTooltip.includes("performance-part-00000")
  )
    throw new Error(
      "Keyboard tooltip did not expose the first FAIL, IST time, and ID.",
    );
  // Exercise real pointer brush input as well as the button zoom path.
  const bounds = await page.locator(".timeline-interaction").boundingBox();
  const beforeBrush = await readCanvas();
  await page.mouse.move(
    bounds.x + 58 + (bounds.width - 75) * 0.3,
    bounds.y + 100,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + 58 + (bounds.width - 75) * 0.7,
    bounds.y + 105,
    { steps: 24 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="timeline-canvas"]')?.dataset
          .visibleMarkers,
      ) < 20000,
  );
  const afterBrush = await readCanvas();
  assertFailures(afterBrush);
  const resetButton = page.getByRole("button", {
    name: "Reset zoom",
    exact: true,
  });
  await resetButton.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="timeline-canvas"]')?.dataset
        .visibleMarkers === "20000",
  );
  const restored = await readCanvas();
  if (restored.failMarkers !== expectedFailures)
    throw new Error("Brush/reset lost FAIL markers.");
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    longTasksSupported:
      PerformanceObserver.supportedEntryTypes.includes("longtask"),
    longTasks: window.__novigoPerformance.longTasks,
  }));
  const expectedByZoom = samples.map((sample) => ({
    action: sample.action,
    failMarkers: sample.failMarkers,
    expectedFailMarkers: sample.expectedFailMarkers,
  }));
  const result = {
    measuredAt: new Date().toISOString(),
    environment,
    fixture: {
      markers: markerCount,
      failures: expectedFailures,
      partModels: 3,
      durationHours: 12,
      unsortedInput: true,
      isolation:
        "Playwright novigo-perf browser-session request interception only; no production code or backend modifications",
    },
    initial,
    zoomSamples: samples,
    zoomFailureCounts: expectedByZoom,
    hover,
    keyboardTooltip,
    brush: { before: beforeBrush, after: afterBrush, reset: restored },
    pageErrors: errors,
    caveat:
      "Machine-specific Chromium development-build timings. drawMs measures chart preparation and base-canvas draw commands, not backend/network time or compositor completion. Hover latency waits two animation frames and includes frame scheduling. Long tasks cover the entire page including React startup and fixture parsing.",
  };
  console.log(`PERFORMANCE_RESULT ${JSON.stringify(result)}`);
  return result;
};
