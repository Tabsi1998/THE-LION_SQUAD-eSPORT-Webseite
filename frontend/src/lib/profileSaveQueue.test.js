// Speicher-Warteschlange für Profil und Einstellungen (#1048, #1061). Dieselben Fälle prüft die App
// (mobile/src/lib/profileSaveQueue.test.ts) - beide lesen profileSaveQueue.cases.json. Die Anfragen an den Server sind
// hier von Hand gesteuert: jede bleibt offen, bis ein Schritt sie beantwortet oder scheitern lässt.
import cases from "./profileSaveQueue.cases.json";
import { createSaveQueue, createSerialLock } from "./profileSaveQueue";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fromServer(data) {
  const { id, updated_at, ...rest } = data || {};
  return rest;
}

function describeResult(result) {
  if (!result) return result;
  const out = { ok: result.ok };
  if (result.nothing) out.nothing = true;
  if (result.reason) out.reason = result.reason;
  if (result.error) out.error = result.error.message;
  return out;
}

async function play({ server, steps }) {
  const requests = [];
  const queue = createSaveQueue({
    fromServer,
    send: (payload, { account }) => new Promise((resolve, reject) => {
      requests.push({ account, payload, resolve, reject, open: true });
    }),
  });
  const results = {};
  const waiting = new Set();
  const stamps = {};
  if (server !== undefined) queue.load(server);
  for (const step of steps) {
    if ("edit" in step) queue.edit(step.edit);
    else if ("flush" in step) {
      const label = step.flush;
      const promise = queue.flush();
      if (label) {
        waiting.add(label);
        promise.then((result) => {
          results[label] = describeResult(result);
          waiting.delete(label);
        });
      }
    } else if ("respond" in step) {
      const request = requests[step.respond];
      request.open = false;
      request.resolve(step.server);
    } else if ("fail" in step) {
      const request = requests[step.fail];
      request.open = false;
      request.reject(new Error(step.error));
    } else if ("load" in step) queue.load(step.load);
    else if ("merge" in step) queue.merge(step.merge, stamps[step.stamp]);
    else if ("stamp" in step) stamps[step.stamp] = queue.stamp();
    else if ("expect" in step) {
      const want = step.expect;
      const state = queue.getState();
      if ("local" in want) expect(state.local).toEqual(want.local);
      if ("dirty" in want) expect(state.dirty).toBe(want.dirty);
      if ("status" in want) expect(state.status).toBe(want.status);
      if ("error" in want) expect(state.error ? state.error.message : null).toBe(want.error);
      if ("account" in want) expect(state.account).toBe(want.account);
      if ("open" in want) expect(requests.filter((item) => item.open).length).toBe(want.open);
      if ("requests" in want) expect(requests.map(({ account, payload }) => ({ account, payload }))).toEqual(want.requests);
      if ("waiting" in want) expect([...waiting].sort()).toEqual([...want.waiting].sort());
      if ("results" in want) {
        for (const [label, result] of Object.entries(want.results)) expect(results[label]).toEqual(result);
      }
    }
    await tick();
    // Grundregel: nie mehr als eine Anfrage gleichzeitig.
    expect(requests.filter((item) => item.open).length).toBeLessThanOrEqual(1);
  }
}

test.each(cases.scenarios)("$name", (scenario) => play(scenario));

test("eine gemeinsame Sperre lässt zwei Warteschlangen nur nacheinander schreiben", async () => {
  const lock = createSerialLock();
  const calls = [];
  const make = (name) => createSaveQueue({
    fromServer,
    lock,
    send: (payload) => new Promise((resolve) => calls.push({ name, payload, resolve })),
  });
  const settings = make("einstellungen");
  const profile = make("profil");
  settings.load({ id: "u1", a: 0 });
  profile.load({ id: "u1", b: 0 });
  settings.edit({ a: 1 });
  profile.edit({ b: 1 });
  const first = settings.flush();
  const second = profile.flush();
  await tick();
  expect(calls.map((call) => call.name)).toEqual(["einstellungen"]);
  calls[0].resolve({ id: "u1", a: 1, b: 0 });
  await first;
  await tick();
  expect(calls.map((call) => call.name)).toEqual(["einstellungen", "profil"]);
  calls[1].resolve({ id: "u1", a: 1, b: 1 });
  expect(await second).toEqual({ ok: true });
});

test("toPayload formt vor dem Vergleich und Senden um", async () => {
  const sent = [];
  const queue = createSaveQueue({
    toPayload: (form) => ({ ...form, games: String(form.games || "").split(",").map((v) => v.trim()).filter(Boolean) }),
    send: (payload) => {
      sent.push(payload);
      return Promise.resolve({ id: "u1", games: "a, b" });
    },
  });
  queue.load({ id: "u1", games: "a" });
  queue.edit({ games: "a,  b" });
  expect(queue.getState().dirty).toBe(true);
  await queue.flush();
  expect(sent).toEqual([{ games: ["a", "b"] }]);
});
