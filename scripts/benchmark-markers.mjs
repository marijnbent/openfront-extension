import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createMarkerHarness } from "../test/helpers/marker-harness.mjs";

const source = await readFile(process.argv[2] ?? new URL("../src/content.js", import.meta.url), "utf8");
const stacks = Object.fromEntries(Array.from({ length: 1000 }, (_, id) => [id, {
  x: (id % 50) * 45,
  y: Math.floor(id / 50) * 45,
  level: 11 + id % 90,
}]));
const times = [];
let result;
for (let run = 0; run < 7; run++) {
  const start = performance.now();
  const harness = createMarkerHarness(source, {
    "data-ofe-building-stacks": JSON.stringify(stacks),
  });
  for (let step = 0; step < 200; step++) {
    harness.setAttribute("data-ofe-map-transform", { x: -600 - step, y: -400, scale: 1 });
    harness.poll();
  }
  times.push(performance.now() - start);
  result = { ...harness.metrics, buildingMarkers: harness.markers("building-stack").length };
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ workload: "1000 stacks, 200 pan updates", medianMs: Number(times[3].toFixed(2)), ...result }, null, 2));
