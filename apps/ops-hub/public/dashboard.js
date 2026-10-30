// Fleet Ops Hub client. All URLs are relative so the page works under
// Connect's /content/<guid>/ path.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HISTORY = 60; // 60 ticks x 2 s = 2 minutes
  const history = [];
  let statusFilter = "";
  let lastMachines = [];

  // ---- Live stream ----
  function connect() {
    const es = new EventSource("api/stream");
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("error", () => setLive(false));
    es.addEventListener("fleet", (e) => {
      const { kpis, machines } = JSON.parse(e.data);
      renderKpis(kpis);
      lastMachines = machines;
      renderMachines();
      if (!history.length || history[history.length - 1].ts < kpis.ts) {
        history.push({ ts: kpis.ts, value: kpis.utilization_pct });
        if (history.length > HISTORY) history.shift();
        renderChart();
      }
    });
    es.addEventListener("work_order", (e) => addWorkOrder(JSON.parse(e.data), true));
  }

  function setLive(on) {
    $("live").classList.toggle("is-live", on);
    $("live-text").textContent = on ? "LIVE" : "RECONNECTING";
  }

  // ---- KPIs ----
  function renderKpis(k) {
    $("k-machines").textContent = k.machines;
    $("k-running").textContent = k.running;
    $("k-alerts").textContent = k.alerts;
    $("k-util").textContent = k.utilization_pct.toFixed(0) + "%";
    $("k-temp").textContent = k.avg_engine_temp_c.toFixed(1) + "°C";
    $("k-alerts").closest(".kpi").classList.toggle("is-alert", k.alerts > 0);
  }

  // ---- Machines table ----
  function renderMachines() {
    const order = { Alert: 0, Running: 1, Idle: 2 };
    const rows = lastMachines
      .filter((m) => !statusFilter || m.status === statusFilter)
      .sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id));
    $("machine-rows").innerHTML = rows
      .map((m) => {
        const codes = m.alerts.map((a) => a.code);
        const title = m.alerts.map((a) => a.label).join("; ");
        return `<tr class="${m.status === "Alert" ? "is-alert" : ""}" title="${esc(title)}">
          <td>${m.id}</td><td>${esc(m.model)}</td><td class="muted">${esc(m.dealer)}</td>
          <td><span class="status ${m.status.toLowerCase()}">${m.status}${codes.length ? " · " + codes.join(", ") : ""}</span></td>
          <td class="num ${codes.includes("ENG-TEMP") ? "hot" : ""}">${m.engine_temp_c.toFixed(1)}</td>
          <td class="num ${codes.includes("HYD-PRESS") ? "hot" : ""}">${m.hydraulic_psi.toLocaleString()}</td>
          <td class="num ${codes.includes("FUEL-LOW") ? "hot" : ""}">${m.fuel_pct.toFixed(0)}</td></tr>`;
      })
      .join("");
  }

  document.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("is-on", b === btn));
      statusFilter = btn.dataset.status;
      renderMachines();
    })
  );

  // ---- Utilization chart (single series, hover crosshair + tooltip) ----
  const NS = "http://www.w3.org/2000/svg";
  function renderChart() {
    const el = $("chart");
    const w = el.clientWidth, h = el.clientHeight;
    const m = { top: 12, right: 56, bottom: 24, left: 36 };
    const iw = w - m.left - m.right, ih = h - m.top - m.bottom;
    const x = (i) => m.left + (HISTORY <= 1 ? 0 : (i + (HISTORY - history.length)) * (iw / (HISTORY - 1)));
    const y = (v) => m.top + ih - (v / 100) * ih;

    let svg = `<svg xmlns="${NS}" viewBox="0 0 ${w} ${h}">`;
    [0, 25, 50, 75, 100].forEach((t) => {
      svg += `<line class="grid-line" x1="${m.left}" x2="${m.left + iw}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text class="axis-label" x="${m.left - 8}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`;
    });
    svg += `<text class="axis-label" x="${m.left}" y="${h - 4}">2 min ago</text>`;
    svg += `<text class="axis-label" x="${m.left + iw}" y="${h - 4}" text-anchor="end">now</text>`;
    if (history.length > 1) {
      const pts = history.map((p, i) => `${x(i)},${y(p.value)}`);
      svg += `<path class="area" d="M${x(0)},${y(0)} L${pts.join(" L")} L${x(history.length - 1)},${y(0)} Z"/>`;
      svg += `<path class="line" d="M${pts.join(" L")}"/>`;
      const last = history[history.length - 1];
      svg += `<text class="end-label" x="${x(history.length - 1) + 8}" y="${y(last.value) + 4}">${last.value.toFixed(0)}%</text>`;
    }
    svg += `<line class="crosshair" id="xh" y1="${m.top}" y2="${m.top + ih}" visibility="hidden"/>`;
    svg += `<circle class="hover-dot" id="xd" r="5" visibility="hidden"/>`;
    svg += `<rect id="hit" x="${m.left}" y="${m.top}" width="${iw}" height="${ih}" fill="transparent"/>`;
    svg += `</svg>`;
    el.innerHTML = svg;

    const hit = el.querySelector("#hit"), xh = el.querySelector("#xh"), xd = el.querySelector("#xd"), tip = $("tooltip");
    hit.addEventListener("mousemove", (ev) => {
      if (!history.length) return;
      const r = el.getBoundingClientRect();
      const px = ev.clientX - r.left;
      let best = 0;
      history.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      const p = history[best];
      xh.setAttribute("x1", x(best)); xh.setAttribute("x2", x(best)); xh.setAttribute("visibility", "visible");
      xd.setAttribute("cx", x(best)); xd.setAttribute("cy", y(p.value)); xd.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.textContent = `${new Date(p.ts).toLocaleTimeString()}  ${p.value.toFixed(1)}% utilized`;
      tip.style.left = ev.clientX + 12 + "px";
      tip.style.top = ev.clientY - 36 + "px";
    });
    hit.addEventListener("mouseleave", () => {
      xh.setAttribute("visibility", "hidden"); xd.setAttribute("visibility", "hidden"); tip.hidden = true;
    });
  }
  window.addEventListener("resize", renderChart);

  // ---- Work orders ----
  function woHtml(w, isNew) {
    const when = new Date(w.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<li class="wo ${isNew ? "is-new" : ""}">
      <div class="wo-top"><span class="wo-id">${esc(w.id)} · ${esc(w.machine_id)}</span><span class="wo-pri ${w.priority.toLowerCase()}">${esc(w.priority).toUpperCase()}</span></div>
      <p class="wo-issue">${esc(w.issue)}</p>
      <p class="wo-meta">${esc(w.source)} · ${esc(w.created_by)} · ${when}</p></li>`;
  }
  function addWorkOrder(w, isNew) {
    $("wo-list").insertAdjacentHTML("afterbegin", woHtml(w, isNew));
  }
  fetch("api/work-orders").then((r) => r.json()).then((list) => {
    $("wo-list").innerHTML = list.map((w) => woHtml(w, false)).join("");
  });

  // ---- Bulletin search ----
  $("search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("q").value.trim() || $("q").placeholder;
    fetch("api/bulletins/search?q=" + encodeURIComponent(q))
      .then((r) => r.json())
      .then((rows) => {
        $("results").innerHTML = rows.length
          ? rows.map((b) => `<li><span class="wo-id">${esc(b.id)}</span><p class="r-title">${esc(b.title)}</p><p class="r-body">${esc(b.body)}</p></li>`).join("")
          : `<li><p class="r-body">No bulletins match "${esc(q)}".</p></li>`;
      });
  });

  // ---- Integration panel ----
  const base = new URL(".", location.href).href;
  const eps = [
    ["GET", "api/machines?status=Alert", "machines in alert"],
    ["GET", "api/export/fleet.csv", "flat table for Power BI"],
    ["POST", "api/work-orders", "create a work order"],
    ["GET", "api/stream", "server-sent events"],
  ];
  $("endpoints").innerHTML = eps.map(([m, p, d]) => `<li><code>${m} ${p}</code> — ${d}</li>`).join("");
  $("pq").textContent =
    `let\n  Source = Csv.Document(\n    Web.Contents("${base}api/export/fleet.csv",\n      [Headers = [Authorization = "Key " & ConnectApiKey]]),\n    [Delimiter = ",", Encoding = 65001]),\n  Fleet = Table.PromoteHeaders(Source)\nin\n  Fleet`;

  fetch("api/kpis/history?ticks=" + HISTORY)
    .then((r) => r.json())
    .then((rows) => {
      rows.forEach((k) => history.push({ ts: k.ts, value: k.utilization_pct }));
      renderChart();
    })
    .finally(connect);
})();
