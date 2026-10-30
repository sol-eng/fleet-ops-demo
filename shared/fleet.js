// Synthetic fleet data shared by ops-hub and ops-mcp.
//
// Every value is a pure function of (seed, time), so each Connect process
// computes the same telemetry for the same moment without shared state.
// All dealers, machines, and bulletins are fictional.

"use strict";

const TICK_MS = 2000;
const EPOCH_TICK = Math.floor(Date.UTC(2026, 0, 1) / TICK_MS); // hours accrue from Jan 1, 2026

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DEALERS = [
  { id: "D01", name: "Prairie Line Equipment", city: "Ames", state: "IA", region: "Midwest" },
  { id: "D02", name: "Riverbend Ag Supply", city: "Peoria", state: "IL", region: "Midwest" },
  { id: "D03", name: "Big Sky Implement", city: "Billings", state: "MT", region: "Northern Plains" },
  { id: "D04", name: "Red River Machinery", city: "Fargo", state: "ND", region: "Northern Plains" },
  { id: "D05", name: "Lone Star Field Works", city: "Lubbock", state: "TX", region: "South" },
  { id: "D06", name: "Delta Harvest Co.", city: "Greenville", state: "MS", region: "South" },
  { id: "D07", name: "Cascade Turf & Tractor", city: "Yakima", state: "WA", region: "West" },
  { id: "D08", name: "Central Valley Equipment", city: "Fresno", state: "CA", region: "West" },
];

const MODELS = [
  { model: "RT-410 row-crop tractor", type: "Tractor", tempBase: 92, pressureBase: 2900 },
  { model: "CX-9 combine", type: "Combine", tempBase: 96, pressureBase: 3100 },
  { model: "SP-12 self-propelled sprayer", type: "Sprayer", tempBase: 88, pressureBase: 2600 },
  { model: "WL-6 wheel loader", type: "Loader", tempBase: 94, pressureBase: 3300 },
  { model: "PL-24 planter tractor", type: "Tractor", tempBase: 90, pressureBase: 2800 },
];

const MACHINES = [];
DEALERS.forEach((dealer, di) => {
  const rand = mulberry32(hash(dealer.id));
  const count = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const spec = MODELS[Math.floor(rand() * MODELS.length)];
    const n = MACHINES.length + 1;
    MACHINES.push({
      id: `M${String(n).padStart(3, "0")}`,
      serial: `1FX${spec.type.slice(0, 2).toUpperCase()}${(4100 + di * 37 + i * 11).toString()}`,
      model: spec.model,
      type: spec.type,
      dealer_id: dealer.id,
      dealer: dealer.name,
      region: dealer.region,
      year: 2019 + Math.floor(rand() * 7),
      base_hours: 300 + Math.floor(rand() * 4200),
      _spec: spec,
      _seed: hash(dealer.id + i),
    });
  }
});

// A few machines drift into alert states on a slow cycle so the
// dashboard always has something to look at.
const ALERT_RULES = [
  { code: "ENG-TEMP", label: "Engine coolant over temperature", test: (t) => t.engine_temp_c >= 104 },
  { code: "HYD-PRESS", label: "Hydraulic pressure low", test: (t) => t.hydraulic_psi < 2300 },
  { code: "FUEL-LOW", label: "Fuel below 12%", test: (t) => t.fuel_pct < 12 },
];

function telemetryAt(machine, now = Date.now()) {
  const tick = Math.floor(now / TICK_MS);
  const r = mulberry32(machine._seed ^ tick);
  const phase = ((tick + (machine._seed % 900)) % 900) / 900; // 30-minute cycle
  const running = phase < 0.72;
  const spike = machine._seed % 5 === 0 && phase > 0.4 && phase < 0.55 ? 14 : 0;
  const drop = machine._seed % 7 === 0 && phase > 0.15 && phase < 0.3 ? 700 : 0;
  const spec = machine._spec;

  const engine_temp_c = running ? round(spec.tempBase + Math.sin(phase * 12) * 3 + r() * 2 + spike, 1) : round(40 + r() * 4, 1);
  const hydraulic_psi = running ? Math.round(spec.pressureBase + (r() - 0.5) * 120 - drop) : 0;
  const fuel_pct = round(Math.max(3, 100 - phase * 95 - (machine._seed % 11)), 1);
  const engine_hours = round(machine.base_hours + (tick - EPOCH_TICK) / 1800 / 4, 1) // ~25% duty cycle;

  const t = { engine_temp_c, hydraulic_psi, fuel_pct, engine_hours };
  const alerts = running ? ALERT_RULES.filter((a) => a.test(t)).map(({ code, label }) => ({ code, label })) : [];
  const status = !running ? "Idle" : alerts.length ? "Alert" : "Running";
  return { machine_id: machine.id, ts: new Date(tick * TICK_MS).toISOString(), status, ...t, alerts };
}

function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function publicMachine(m) {
  const { _spec, _seed, base_hours, ...rest } = m;
  return rest;
}

function withTelemetry(m, now) {
  const { machine_id, ...t } = telemetryAt(m, now);
  return { ...publicMachine(m), ...t };
}

function fleetSnapshot(now = Date.now()) {
  return MACHINES.map((m) => withTelemetry(m, now));
}

function findMachines({ status, dealer, type, region } = {}, now = Date.now()) {
  const q = (s) => (s ? String(s).toLowerCase() : null);
  return fleetSnapshot(now).filter(
    (m) =>
      (!status || m.status.toLowerCase() === q(status)) &&
      (!dealer || m.dealer.toLowerCase().includes(q(dealer)) || m.dealer_id.toLowerCase() === q(dealer)) &&
      (!type || m.type.toLowerCase() === q(type)) &&
      (!region || m.region.toLowerCase() === q(region))
  );
}

function getMachine(id, now = Date.now()) {
  const m = MACHINES.find((x) => x.id.toLowerCase() === String(id).toLowerCase() || x.serial === id);
  return m ? withTelemetry(m, now) : null;
}

function kpis(now = Date.now()) {
  const snap = fleetSnapshot(now);
  const count = (s) => snap.filter((m) => m.status === s).length;
  const running = snap.filter((m) => m.status !== "Idle");
  return {
    ts: new Date(Math.floor(now / TICK_MS) * TICK_MS).toISOString(),
    machines: snap.length,
    running: count("Running"),
    idle: count("Idle"),
    alerts: count("Alert"),
    utilization_pct: round((running.length / snap.length) * 100, 1),
    avg_engine_temp_c: round(running.reduce((a, m) => a + m.engine_temp_c, 0) / Math.max(1, running.length), 1),
  };
}

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object");
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

module.exports = { TICK_MS, DEALERS, MACHINES: MACHINES.map(publicMachine), fleetSnapshot, findMachines, getMachine, kpis, telemetryAt, toCsv };
