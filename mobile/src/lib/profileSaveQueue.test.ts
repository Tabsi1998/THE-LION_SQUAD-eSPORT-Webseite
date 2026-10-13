import fs from "fs";
import path from "path";
import { createSaveQueue, createSerialLock, type SaveResult } from "./profileSaveQueue";

// Speicher-Warteschlange für Profil und Einstellungen (#1048, #1061): dieselben Fälle wie auf der Website - beide lesen
// frontend/src/lib/profileSaveQueue.cases.json. Ändert jemand die Regeln auf einer Seite, wird der Test der anderen rot.
// Die Anfragen an den Server sind von Hand gesteuert: jede bleibt offen, bis ein Schritt sie beantwortet.
type Data = Record<string, any>;
type Step = Record<string, any>;
type Scenario = { name: string; server?: Data | null; steps: Step[] };
const CASES: { scenarios: Scenario[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/profileSaveQueue.cases.json"), "utf8"),
);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fromServer(data: Data | null | undefined): Data {
  const { id: _id, updated_at: _rev, ...rest } = data || {};
  return rest;
}

function describeResult(result: SaveResult) {
  const out: Data = { ok: result.ok };
  if (result.nothing) out.nothing = true;
  if (result.reason) out.reason = result.reason;
  if (result.error) out.error = (result.error as Error).message;
  return out;
}

type Request = { account: string | null; payload: Data; resolve: (data: Data) => void; reject: (error: Error) => void; open: boolean };

async function play({ server, steps }: Scenario) {
  const requests: Request[] = [];
  const queue = createSaveQueue<Data>({
    fromServer,
    send: (payload, { account }) => new Promise<Data>((resolve, reject) => {
      requests.push({ account, payload, resolve, reject, open: true });
    }),
  });
  const results: Record<string, Data> = {};
  const waiting = new Set<string>();
  const stamps: Record<string, number> = {};
  if (server !== undefined) queue.load(server);
  for (const step of steps) {
    if ("edit" in step) queue.edit(step.edit);
    else if ("flush" in step) {
      const label = step.flush as string | null;
      const promise = queue.flush();
      if (label) {
        waiting.add(label);
        void promise.then((result) => {
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
      const want = step.expect as Data;
      const state = queue.getState();
      if ("local" in want) expect(state.local).toEqual(want.local);
      if ("dirty" in want) expect(state.dirty).toBe(want.dirty);
      if ("status" in want) expect(state.status).toBe(want.status);
      if ("error" in want) expect(state.error ? (state.error as Error).message : null).toBe(want.error);
      if ("account" in want) expect(state.account).toBe(want.account);
      if ("open" in want) expect(requests.filter((item) => item.open).length).toBe(want.open);
      if ("requests" in want) expect(requests.map(({ account, payload }) => ({ account, payload }))).toEqual(want.requests);
      if ("waiting" in want) expect([...waiting].sort()).toEqual([...want.waiting].sort());
      if ("results" in want) {
        for (const [label, result] of Object.entries(want.results as Data)) expect(results[label]).toEqual(result);
      }
    }
    await tick();
    // Grundregel: nie mehr als eine Anfrage gleichzeitig.
    expect(requests.filter((item) => item.open).length).toBeLessThanOrEqual(1);
  }
}

test.each(CASES.scenarios)("$name", (scenario) => play(scenario));

test("eine gemeinsame Sperre lässt Einstellungen und Profil nur nacheinander schreiben", async () => {
  const lock = createSerialLock();
  const calls: { name: string; resolve: (data: Data) => void }[] = [];
  const make = (name: string) => createSaveQueue<Data>({
    fromServer,
    lock,
    send: () => new Promise<Data>((resolve) => { calls.push({ name, resolve }); }),
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
