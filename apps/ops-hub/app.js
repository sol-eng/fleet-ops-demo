// Fleet Ops Hub: real-time dashboard + REST API, hosted on Posit Connect.
//
// Connect sets HOST and PORT. Every URL the browser uses is relative, because
// Connect serves the app under /content/<guid>/.

"use strict";

const path = require("node:path");
const express = require("express");
const fleet = require("./lib/fleet");
const { searchBulletins } = require("./lib/bulletins");

const app = express();
app.use(express.json());

// Connect passes the signed-in viewer in this header. Fall back for local runs.
function viewer(req) {
  try {
    const creds = JSON.parse(req.get("RStudio-Connect-Credentials") || "null");
    if (creds && creds.user) return creds.user;
  } catch (_) {}
  return "local-dev";
}

// ---- Work orders: in memory. Content is pinned to one process (see README). ----
let nextWo = 1004;
const workOrders = [
  { id: "WO-1001", machine_id: "M004", issue: "Rotary screen brush kit replacement", priority: "Medium", status: "Open", created_by: "scheduler", source: "Planned maintenance", created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: "WO-1002", machine_id: "M011", issue: "Hydraulic oil sample at 3,250 hours", priority: "Low", status: "In progress", created_by: "scheduler", source: "Planned maintenance", created_at: new Date(Date.now() - 43200000).toISOString() },
  { id: "WO-1003", machine_id: "M019", issue: "Gateway firmware update to 3.9", priority: "Low", status: "Open", created_by: "scheduler", source: "Planned maintenance", created_at: new Date(Date.now() - 7200000).toISOString() },
];
const subscribers = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  subscribers.forEach((res) => res.write(msg));
}

// ---- API ----
const api = express.Router();

api.get("/health", (req, res) => {
  res.json({ ok: true, node: process.version, pid: process.pid, viewer: viewer(req) });
});

api.get("/dealers", (req, res) => res.json(fleet.DEALERS));

api.get("/kpis", (req, res) => res.json(fleet.kpis()));

// Telemetry is a pure function of time, so history is cheap to recompute.
api.get("/kpis/history", (req, res) => {
  const ticks = Math.min(Number(req.query.ticks) || 60, 900);
  const now = Date.now();
  res.json(Array.from({ length: ticks }, (_, i) => fleet.kpis(now - (ticks - 1 - i) * fleet.TICK_MS)));
});

api.get("/machines", (req, res) => {
  const { status, dealer, type, region } = req.query;
  res.json(fleet.findMachines({ status, dealer, type, region }));
});

api.get("/machines/:id", (req, res) => {
  const m = fleet.getMachine(req.params.id);
  if (!m) return res.status(404).json({ error: `No machine ${req.params.id}` });
  res.json({ ...m, work_orders: workOrders.filter((w) => w.machine_id === m.id) });
});

api.get("/bulletins/search", (req, res) => {
  res.json(searchBulletins(req.query.q || "", Number(req.query.limit) || 3));
});

api.get("/work-orders", (req, res) => res.json(workOrders));

api.post("/work-orders", (req, res) => {
  const { machine_id, issue, priority = "Medium", source = "API", requested_by } = req.body || {};
  const m = machine_id && fleet.getMachine(machine_id);
  if (!m) return res.status(400).json({ error: "machine_id must be a known machine, e.g. M004" });
  if (!issue) return res.status(400).json({ error: "issue is required" });
  const wo = {
    id: `WO-${nextWo++}`,
    machine_id: m.id,
    issue: String(issue).slice(0, 200),
    priority: ["Low", "Medium", "High"].includes(priority) ? priority : "Medium",
    status: "Open",
    created_by: requested_by || viewer(req),
    source: String(source).slice(0, 40),
    created_at: new Date().toISOString(),
  };
  workOrders.unshift(wo);
  broadcast("work_order", wo);
  res.status(201).json(wo);
});

// Flat CSV for Power BI's Web connector (Get Data > Web).
api.get("/export/fleet.csv", (req, res) => {
  res.type("text/csv").send(fleet.toCsv(fleet.fleetSnapshot()));
});
api.get("/export/work-orders.csv", (req, res) => {
  res.type("text/csv").send(fleet.toCsv(workOrders));
});

// Server-sent events: one fleet frame per tick, plus work-order events.
api.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = () => res.write(`event: fleet\ndata: ${JSON.stringify({ kpis: fleet.kpis(), machines: fleet.fleetSnapshot() })}\n\n`);
  send();
  const timer = setInterval(send, fleet.TICK_MS);
  subscribers.add(res);
  req.on("close", () => {
    clearInterval(timer);
    subscribers.delete(res);
  });
});

app.use("/api", api);
app.use("/brand", express.static(path.join(__dirname, "lib", "brand")));
app.use(express.static(path.join(__dirname, "public")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, process.env.HOST, () => {
  console.log(`Fleet Ops Hub listening on ${process.env.HOST || "localhost"}:${port}`);
});
