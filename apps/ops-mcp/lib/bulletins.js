// Fictional service bulletins and a small TF-IDF search over them.
// Stands in for a document store (SharePoint, Dataverse, EDL) in the demo.

"use strict";

const BULLETINS = [
  {
    id: "SB-2026-014",
    title: "Coolant over-temperature on CX-9 combines in high-chaff conditions",
    applies_to: ["CX-9 combine"],
    alert_codes: ["ENG-TEMP"],
    body:
      "Operators report engine overheating on combines in dry, high-chaff crops. Chaff build-up on the rotary screen restricts airflow to the radiator. If coolant temperature exceeds 104 C, " +
      "reduce ground speed, run the reverser fan cycle, and inspect the rotary screen seals. Replace the screen brush " +
      "kit (part RS-2210) if bristles are worn below 8 mm. Estimated labor: 1.5 hours.",
  },
  {
    id: "SB-2026-018",
    title: "Engine overheating on WL-6 wheel loaders in dusty yard work",
    applies_to: ["WL-6 wheel loader"],
    alert_codes: ["ENG-TEMP"],
    body:
      "Dust packs the stacked cooler cores on loaders that work in aggregate and feed yards, and coolant can pass " +
      "104 C under load. Enable the automatic reversing fan at a 15-minute interval, blow out the cooler cores, and " +
      "check the fan clutch. Fit the wide-fin cooler screen (part CS-0912) for dusty sites. Estimated labor: 1 hour.",
  },
  {
    id: "SB-2026-009",
    title: "Hydraulic pressure drop after cold start on WL-6 wheel loaders",
    applies_to: ["WL-6 wheel loader"],
    alert_codes: ["HYD-PRESS"],
    body:
      "A sticking load-sense relief valve can cause system pressure below 2300 psi for the first 20 minutes after a " +
      "cold start. Warm the hydraulic oil to 40 C before full load. If the fault persists, replace the relief valve " +
      "cartridge (part HV-0457) and recalibrate the pump stroke. Estimated labor: 2 hours.",
  },
  {
    id: "SB-2026-021",
    title: "False low-fuel warnings on SP-12 sprayers with the 2025 tank sender",
    applies_to: ["SP-12 self-propelled sprayer"],
    alert_codes: ["FUEL-LOW"],
    body:
      "Some 2025 tank sender units report fuel up to 15 percent low on side slopes. Update the display controller to " +
      "firmware 4.18 or later, which applies slope compensation. No hardware change is needed. Estimated labor: 0.5 hours.",
  },
  {
    id: "SB-2025-077",
    title: "Engine overheating on RT-410 and PL-24 tractors during sustained heavy draft",
    applies_to: ["RT-410 row-crop tractor", "PL-24 planter tractor"],
    alert_codes: ["ENG-TEMP"],
    body:
      "Sustained heavy draft above 85 percent load in ambient temperatures over 32 C can push coolant past 104 C. " +
      "Check the fan drive belt tension, clean the charge-air cooler fins, and confirm the coolant mix is 50/50. " +
      "Install the high-capacity fan kit (part FK-3301) for operations in hot regions. Estimated labor: 3 hours.",
  },
  {
    id: "SB-2025-063",
    title: "Hydraulic pressure fluctuation on RT-410 tractors with rear SCV kit",
    applies_to: ["RT-410 row-crop tractor"],
    alert_codes: ["HYD-PRESS"],
    body:
      "Tractors with the aftermarket rear selective control valve kit can show pressure swings of 400 psi when two " +
      "remotes run at once. Fit the priority flow divider (part PF-1188) and update the hitch controller software.",
  },
  {
    id: "SB-2026-031",
    title: "Planter downforce calibration after firmware 7.2",
    applies_to: ["PL-24 planter tractor"],
    alert_codes: [],
    body:
      "Firmware 7.2 resets hydraulic downforce targets to factory defaults. After the update, recalibrate the " +
      "downforce margin per field profile. Operators can do this from the cab display in about 10 minutes.",
  },
  {
    id: "SB-2026-005",
    title: "Recommended service intervals for high-hour loaders",
    applies_to: ["WL-6 wheel loader"],
    alert_codes: [],
    body:
      "For loaders above 3000 engine hours, shorten hydraulic filter changes to every 500 hours and sample the " +
      "hydraulic oil every 250 hours. Inspect the boom pivot pins for wear at each interval.",
  },
  {
    id: "SB-2026-040",
    title: "Telematics gateway drops data in low-signal areas",
    applies_to: ["RT-410 row-crop tractor", "CX-9 combine", "SP-12 self-propelled sprayer", "WL-6 wheel loader", "PL-24 planter tractor"],
    alert_codes: [],
    body:
      "Gateways on firmware older than 3.9 do not buffer telemetry when cellular signal is lost, which leaves gaps in " +
      "dashboards. Update the gateway to 3.9 or later to store up to 72 hours of data and send it on reconnect.",
  },
];

const tokenize = (s) => String(s).toLowerCase().match(/[a-z0-9-]+/g) || [];

const docs = BULLETINS.map((b) => {
  const tokens = tokenize([b.id, b.title, b.title, b.applies_to.join(" "), b.alert_codes.join(" "), b.body].join(" "));
  const tf = new Map();
  tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  return { b, tf, len: tokens.length };
});

const df = new Map();
docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));

function searchBulletins(query, limit = 3) {
  const terms = tokenize(query);
  return docs
    .map((d) => {
      const score = terms.reduce((s, t) => {
        const tf = d.tf.get(t) || 0;
        if (!tf) return s;
        const idf = Math.log(1 + docs.length / (df.get(t) || 1));
        return s + (tf / d.len) * idf;
      }, 0);
      return { ...d.b, score: Math.round(score * 1000) / 1000 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { BULLETINS, searchBulletins };
