// Exercise the actual Vercel handler with the real assignment backend locally.
// Prints only status codes and counts; never logs credentials or bearer tokens.
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
  response.status = function (code) {
    this.statusCode = code;
    return this;
  };
  response.json = function (value) {
    this.setHeader("Content-Type", "application/json");
    this.end(JSON.stringify(value));
    return this;
  };
  await handler(request, response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
let token;
const results = [];
async function request(path, body, authenticated = true) {
  const response = await fetch(`${base}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
try {
  token = (
    await request(
      "auth/login",
      {
        username: process.env.DEMO_USERNAME || "analytics_user",
        password: process.env.DEMO_PASSWORD || "dashboard123",
      },
      false,
    )
  ).access_token;
  assert.ok(token, "Login must return a token");
  const user = await request("auth/me");
  assert.ok(user.name, "Profile must include name");
  const tree = await request("core/assets/tree");
  const nodes = [];
  const visit = (rows) => {
    for (const node of rows) {
      nodes.push(node);
      visit(node.children || []);
    }
  };
  visit(tree);
  const asset = nodes.find((node) => /line\s*1\s*spi/i.test(node.name));
  assert.ok(asset, "Assignment machine must exist");
  const shift = (await request("core/shifts")).find((row) => row.is_active);
  const times = [...shift.shift_timings].sort();
  const start = Date.parse(`2026-09-01T${times[0]}:00+05:30`);
  let end = Date.parse(`2026-09-01T${times[1] || times[0]}:00+05:30`);
  if (end <= start) end += 86_400_000;
  const scope = {
    entity_scope: {
      type: "asset",
      asset: { asset_id: asset.id, asset_level_id: asset.assetlevel_id },
    },
    time_range: {
      from_ts: new Date(start).toISOString(),
      to_ts: new Date(end).toISOString(),
    },
  };
  const coarse = await request("analytics-query/machine-intervals", {
    ...scope,
    produce_counts: true,
    exact_produces: false,
    group_produce_counts_by_part_model: true,
  });
  assert.ok(
    Array.isArray(coarse.produce_counts),
    "Hourly counts must be an array",
  );
  const exact = await request("analytics-query/machine-intervals", {
    ...scope,
    produce_counts: true,
    exact_produces: true,
    group_produce_counts_by_part_model: true,
  });
  const produces = (exact.produces || []).reduce(
    (sum, bucket) => sum + bucket.produces.length,
    0,
  );
  const cycles = await request("analytics-query", {
    ...scope,
    metrics: ["ideal_cycle_time_seconds", "actual_cycle_time_seconds"],
    distribution: "hourly",
  });
  assert.ok(Array.isArray(cycles), "Cycle-time rows must be an array");
  await request("auth/logout", {});
  token = undefined;
  console.log(
    JSON.stringify(
      {
        success: true,
        requests: results,
        exactProduces: produces,
        cycleBuckets: cycles.length,
      },
      null,
      2,
    ),
  );
} finally {
  token = undefined;
  await new Promise((resolve) => server.close(resolve));
}
