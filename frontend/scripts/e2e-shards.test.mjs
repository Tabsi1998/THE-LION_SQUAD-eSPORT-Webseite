// Selbsttest der Verteilung der Browser-Tests auf die CI-Teile (#2054): node --test scripts/e2e-shards.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { collectTests, durationsFromReports, groupKey, planShards } from "./e2e-shards.mjs";

const spec = (title, project, file, duration = 0) => ({
  title, file, tests: [{ projectName: project, results: duration ? [{ duration: duration * 1000 }] : [] }],
});

const REPORT = {
  suites: [
    { title: "a.spec.js", file: "a.spec.js", specs: [spec("eins", "chromium", "a.spec.js", 30), spec("eins", "mobile", "a.spec.js", 10)] },
    {
      title: "b.spec.js", file: "b.spec.js", specs: [],
      suites: [{ title: "Gruppe", file: "b.spec.js", specs: [spec("zwei", "chromium", "b.spec.js", 5), spec("drei", "chromium", "b.spec.js", 5)] }],
    },
    // Tests aus einer Hilfsdatei (wie seasonQa.js): Ort ist die Hilfsdatei, die Gruppe die Testdatei.
    { title: "c.spec.js", file: "c.spec.js", specs: [], suites: [{ title: "Saison C", file: "helper.js", specs: [spec("PC", "chromium", "helper.js", 20)] }] },
    { title: "d.spec.js", file: "d.spec.js", specs: [], suites: [{ title: "Saison D", file: "helper.js", specs: [spec("PC", "chromium", "helper.js", 20)] }] },
    { title: "e.spec.js", file: "e.spec.js", specs: [spec("neu", "chromium", "e.spec.js")] },
  ],
};

test("jeder Test landet in genau einem Teil, Dateien bleiben je Projekt beisammen", () => {
  const tests = collectTests(REPORT);
  for (const total of [1, 2, 3, 6]) {
    const shards = planShards(tests, total, durationsFromReports([REPORT]));
    const placed = shards.flatMap((shard) => shard.tests);
    assert.equal(placed.length, tests.length);
    assert.equal(new Set(placed).size, tests.length);
    const shardOf = new Map();
    shards.forEach((shard, index) => shard.tests.forEach((item) => {
      if (shardOf.has(groupKey(item))) assert.equal(shardOf.get(groupKey(item)), index, groupKey(item));
      shardOf.set(groupKey(item), index);
    }));
  }
});

test("die längsten Gruppen verteilen sich zuerst", () => {
  const tests = collectTests(REPORT);
  const [first, second] = planShards(tests, 2, durationsFromReports([REPORT]));
  assert.ok(Math.abs(first.seconds - second.seconds) <= 30, `${first.seconds} gegen ${second.seconds}`);
});

test("gleiche Titel aus einer Hilfsdatei bleiben im selben Teil", () => {
  const tests = collectTests(REPORT);
  for (const total of [2, 3, 6]) {
    const shards = planShards(tests, total, {});
    const index = (specFile) => shards.findIndex((shard) => shard.tests.some((item) => item.specFile === specFile));
    // Unterschiedliche describe-Titel: getrennt planbar, aber nie doppelt.
    assert.notEqual(index("c.spec.js"), -1);
    assert.notEqual(index("d.spec.js"), -1);
  }
  const twins = {
    suites: [
      { title: "c.spec.js", file: "c.spec.js", specs: [], suites: [{ title: "Gleich", file: "helper.js", specs: [spec("PC", "chromium", "helper.js")] }] },
      { title: "d.spec.js", file: "d.spec.js", specs: [], suites: [{ title: "Gleich", file: "helper.js", specs: [spec("PC", "chromium", "helper.js")] }] },
    ],
  };
  const shards = planShards(collectTests(twins), 2, {});
  assert.equal(shards.filter((shard) => shard.tests.length).length, 1, "dieselbe Zeile wählt beide Tests - ein Teil");
});

test("Dauern summieren alle Versuche je Gruppe", () => {
  assert.deepEqual(durationsFromReports([REPORT, REPORT])["[chromium] › a.spec.js"], 60);
  assert.equal(durationsFromReports([REPORT])["[chromium] › e.spec.js"], 0);
});

test("die Dauer-Dateien der Teile lassen sich wieder zusammenzählen", () => {
  const parts = [{ "[chromium] › a.spec.js": 30 }, { "[mobile] › a.spec.js": 10, "[chromium] › a.spec.js": 5 }];
  assert.deepEqual(durationsFromReports([...parts, REPORT]), {
    "[chromium] › a.spec.js": 65,
    "[chromium] › b.spec.js": 10,
    "[chromium] › c.spec.js": 20,
    "[chromium] › d.spec.js": 20,
    "[chromium] › e.spec.js": 0,
    "[mobile] › a.spec.js": 20,
  });
});
