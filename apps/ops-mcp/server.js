// Fleet Ops MCP server, hosted on Posit Connect.
//
// Streamable HTTP in stateless mode: each POST to /mcp gets a fresh server
// and transport, so it works when Connect runs more than one process.
// Clients authenticate to Connect with "Authorization: Key <api key>".

"use strict";

const path = require("node:path");
const express = require("express");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const fleet = require("./lib/fleet");
const { searchBulletins } = require("./lib/bulletins");

// Where work orders go. Set OPS_HUB_URL in the Connect "Vars" panel to the
// ops-hub content URL. Connect gives every content process a short-lived
// CONNECT_API_KEY, which we use to call ops-hub as this content's owner.
const OPS_HUB_URL = (process.env.OPS_HUB_URL || "").replace(/\/+$/, "");
const localWorkOrders = [];

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

function viewer(req) {
  try {
    const creds = JSON.parse(req.get("RStudio-Connect-Credentials") || "null");
    if (creds && creds.user) return creds.user;
  } catch (_) {}
  return "mcp-client";
}

async function hub(method, route, body) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.CONNECT_API_KEY) headers.Authorization = `Key ${process.env.CONNECT_API_KEY}`;
  const res = await fetch(`${OPS_HUB_URL}/${route}`, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`ops-hub ${method} ${route} returned ${res.status}`);
  return res.json();
}

function buildServer(req) {
  const server = new McpServer({ name: "fleet-ops", version: "1.0.0" });

  server.registerTool(
    "fleet_summary",
    {
      title: "Fleet summary",
      description: "Current fleet KPIs: machine count, running, idle, in alert, utilization, and average engine temperature.",
      inputSchema: {},
    },
    async () => json(fleet.kpis())
  );

  server.registerTool(
    "find_machines",
    {
      title: "Find machines",
      description:
        "List machines with live telemetry. Filter by status (Running, Idle, Alert), dealer name or ID, " +
        "machine type (Tractor, Combine, Sprayer, Loader), or region (Midwest, Northern Plains, South, West).",
      inputSchema: {
        status: z.enum(["Running", "Idle", "Alert"]).optional(),
        dealer: z.string().optional().describe("Dealer name (partial match) or dealer ID like D03"),
        type: z.enum(["Tractor", "Combine", "Sprayer", "Loader"]).optional(),
        region: z.enum(["Midwest", "Northern Plains", "South", "West"]).optional(),
      },
    },
    async (args) => json(fleet.findMachines(args))
  );

  server.registerTool(
    "machine_detail",
    {
      title: "Machine detail",
      description: "Live telemetry, active alerts, and dealer for one machine, by ID (like M013) or serial number.",
      inputSchema: { machine_id: z.string() },
    },
    async ({ machine_id }) => {
      const m = fleet.getMachine(machine_id);
      return m ? json(m) : { isError: true, content: [{ type: "text", text: `No machine ${machine_id}` }] };
    }
  );

  server.registerTool(
    "search_service_bulletins",
    {
      title: "Search service bulletins",
      description:
        "Search the service bulletin library. Use alert codes (ENG-TEMP, HYD-PRESS, FUEL-LOW), model names, " +
        "or symptoms. Returns the best matches with the fix, parts, and estimated labor.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(5).optional() },
    },
    async ({ query, limit }) => json(searchBulletins(query, limit || 3))
  );

  server.registerTool(
    "list_work_orders",
    {
      title: "List work orders",
      description: "List open and recent service work orders.",
      inputSchema: {},
    },
    async () => json(OPS_HUB_URL ? await hub("GET", "api/work-orders") : localWorkOrders)
  );

  server.registerTool(
    "create_work_order",
    {
      title: "Create work order",
      description:
        "Open a service work order for a machine. Use this after you have checked the machine and the relevant " +
        "service bulletin. The work order appears on the Fleet Ops Hub dashboard right away.",
      inputSchema: {
        machine_id: z.string().describe("Machine ID like M013"),
        issue: z.string().describe("Short description of the problem and the planned fix, citing the bulletin ID"),
        priority: z.enum(["Low", "Medium", "High"]).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ machine_id, issue, priority }) => {
      const body = { machine_id, issue, priority: priority || "Medium", source: "AI assistant (MCP)", requested_by: viewer(req) };
      if (OPS_HUB_URL) return json(await hub("POST", "api/work-orders", body));
      const wo = { id: `WO-L${localWorkOrders.length + 1}`, ...body, status: "Open", created_at: new Date().toISOString() };
      localWorkOrders.unshift(wo);
      return json({ ...wo, note: "OPS_HUB_URL is not set, so this work order is stored only in the MCP server." });
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = buildServer(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

// Stateless mode: no SSE stream or session to delete.
const notAllowed = (req, res) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

app.get("/api/health", (req, res) => res.json({ ok: true, node: process.version, ops_hub: Boolean(OPS_HUB_URL), connect_key: Boolean(process.env.CONNECT_API_KEY) }));

app.use("/brand", express.static(path.join(__dirname, "lib", "brand")));
app.use(express.static(path.join(__dirname, "public")));

const port = Number(process.env.PORT) || 3001;
app.listen(port, process.env.HOST, () => {
  console.log(`Fleet Ops MCP server listening on ${process.env.HOST || "localhost"}:${port}/mcp`);
});
