// Run the Vercel proxy against the assignment API. Logs contain counts and statuses only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import handler from "../api/proxy.js";

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  request.body = body ? JSON.parse(body) : undefined;
  request.query = {
    path: new URL(request.url, "http://localhost").pathname.replace(
      /^\/api\//,
      "",
    ),
  };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (value) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
    return response;
  };
  await handler(request, response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
let token;
const results = [];
async function request(path, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const envelope = await response.json();
  results.push({
    path,
    status: response.status,
    envelopeStatus: envelope.status_code,
  });
  assert.equal(response.status, 200, `${path} must succeed`);
  assert.equal(envelope.status_code, 200, `${path} envelope must succeed`);
  return envelope.data;
}

let counts;
try {
  const login = await request("auth/login", {
    username: process.env.DEMO_USERNAME || "analytics_user",
    password: process.env.DEMO_PASSWORD || "dashboard123",
  });
  token = login.access_token;
  assert.ok(token, "Login must return a token");

  const user = await request("auth/me");
  assert.ok(user.name, "Profile must include name");

  const tree = await request("core/assets/tree");
  const assets = [];
  function collectAssets(rows) {
    for (const asset of rows) {
      assets.push(asset);
      collectAssets(asset.children || []);
    }
  }
  collectAssets(tree);
  const machine = assets.find((asset) => /line\s*1\s*spi/i.test(asset.name));
  assert.ok(machine, "Assignment machine must exist");

  const shift = (await request("core/shifts")).find((row) => row.is_active);
  assert.ok(shift, "An active shift must exist");
  const shiftTimes = [...shift.shift_timings].sort();
  const start = Date.parse(`2026-09-01T${shiftTimes[0]}:00+05:30`);
  let end = Date.parse(`2026-09-01T${shiftTimes[1] || shiftTimes[0]}:00+05:30`);
  if (end <= start) end += 86_400_000;
  const query = {
    entity_scope: {
      type: "asset",
      asset: { asset_id: machine.id, asset_level_id: machine.assetlevel_id },
    },
    time_range: {
      from_ts: new Date(start).toISOString(),
      to_ts: new Date(end).toISOString(),
    },
  };
  const hourlyData = await request("analytics-query/machine-intervals", {
    ...query,
    produce_counts: true,
    exact_produces: false,
    group_produce_counts_by_part_model: true,
  });
  assert.ok(
    Array.isArray(hourlyData.produce_counts),
    "Hourly counts must be an array",
  );
  const exactData = await request("analytics-query/machine-intervals", {
    ...query,
    produce_counts: true,
    exact_produces: true,
    group_produce_counts_by_part_model: true,
  });
  const produceCount = (exactData.produces || []).reduce(
    (sum, bucket) => sum + bucket.produces.length,
    0,
  );
  const cycleTimes = await request("analytics-query", {
    ...query,
    metrics: ["ideal_cycle_time_seconds", "actual_cycle_time_seconds"],
    distribution: "hourly",
  });
  assert.ok(Array.isArray(cycleTimes), "Cycle-time rows must be an array");
  counts = { exactProduces: produceCount, cycleBuckets: cycleTimes.length };
} finally {
  try {
    // Also log out when a check fails after login.
    if (token) await request("auth/logout", {});
  } finally {
    token = undefined;
    await new Promise((resolve) => server.close(resolve));
  }
}

console.log(
  JSON.stringify({ success: true, requests: results, ...counts }, null, 2),
);
