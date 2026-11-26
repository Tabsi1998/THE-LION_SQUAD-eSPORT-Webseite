import { act, render, waitFor } from "@testing-library/react";

// Saisonende-Moment (#1639): Die Browser-Marken (Geräte-Schlüssel, „fertig noch nicht gemeldet“) hängen an der Person, nicht nur am
// Moment - meldet sich am selben Browser eine andere Person desselben Co-Teams an, gilt ihr Moment nicht still als gesehen. Abmelden
// räumt die Marken weg.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { momentPackage, finishedHere } = await import("./momentPackage");
const { AuthProvider, useAuth } = await import("@/context/AuthContext");

const moment = { id: "m-up", outcome: "up", texts: { kicker: "Aufstieg" }, rewards: [] };

beforeEach(() => {
  window.localStorage.clear();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("„fertig“ ging nicht durch: die Marke gilt nur für diese Person", async () => {
  const client = { post: vi.fn((url) => (url.endsWith("/done") ? Promise.reject(new Error("offline")) : Promise.resolve({ data: { claimed: ["m-up"] } }))) };
  const pkg = momentPackage(moment, client, "person-a");
  await pkg.check();
  pkg.onDone();
  await waitFor(() => expect(finishedHere("person-a", moment)).toBe(true));
  expect(finishedHere("person-b", moment)).toBe(false);
});

test("der Geräte-Schlüssel ist je Person verschieden", async () => {
  const client = { post: vi.fn(() => Promise.resolve({ data: { claimed: [] } })) };
  await momentPackage(moment, client, "person-a").check();
  await momentPackage(moment, client, "person-b").check();
  const [first, second] = client.post.mock.calls.map((call) => call[1].token);
  expect(first).not.toBe(second);
});

test("Abmelden räumt die Marken des Moments weg", async () => {
  apiMock.get.mockResolvedValue({ data: { id: "person-a", username: "neonfalke" }, headers: {} });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  let auth = null;
  function Probe() {
    auth = useAuth();
    return null;
  }
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.user?.id).toBe("person-a"));
  const client = { post: vi.fn((url) => (url.endsWith("/done") ? Promise.reject(new Error("offline")) : Promise.resolve({ data: { claimed: ["m-up"] } }))) };
  const pkg = momentPackage(moment, client, "person-a");
  await pkg.check();
  pkg.onDone();
  await waitFor(() => expect(finishedHere("person-a", moment)).toBe(true));
  await act(async () => { await auth.logout(); });
  expect(finishedHere("person-a", moment)).toBe(false);
  expect(Object.keys(window.localStorage).filter((key) => key.startsWith("tls_moment_"))).toEqual([]);
});

// ---------------------------------------------------------------- Stand der Marke (#2591, Nr. 277)

const { enqueueMoments } = await import("./momentPackage");
const { doneKey, momentVersion } = await import("@/lib/momentMarks");

const confirmed = { ...moment, confirmed_at: "2026-11-20T18:00:00+00:00", corrected: false, to: { level: 1 } };
const corrected = { ...confirmed, outcome: "down", corrected: true, confirmed_at: "2026-11-26T09:00:00+00:00", to: { level: 2 } };

function enqueue(rows) {
  const queue = { enqueue: vi.fn() };
  const client = { post: vi.fn(() => Promise.resolve({ data: {} })) };
  enqueueMoments(rows, { queue, client, queued: new Set(), userId: "person-a" });
  return { queue, client };
}

test("der Stand folgt der App: Bestätigung, Korrektur, Ausgang und Liga N - Texte und Belohnungen zählen nicht", () => {
  expect(momentVersion(confirmed)).toBe("2026-11-20T18:00:00+00:00||up|1");
  expect(momentVersion(corrected)).toBe("2026-11-26T09:00:00+00:00|k|down|2");
  // Gleicher Ausgang, gleicher Stand: kein neuer Moment (Nr. 277).
  expect(momentVersion({ ...confirmed, texts: { kicker: "Anders" }, rewards: [{ id: "r" }], next_step: { url: "/x" } })).toBe(momentVersion(confirmed));
  for (const changed of [{ confirmed_at: "2026-11-21T10:00:00+00:00" }, { corrected: true }, { outcome: "down" }, { to: { level: 2 } }]) {
    expect(momentVersion({ ...confirmed, ...changed })).not.toBe(momentVersion(confirmed));
  }
});

test("„fertig“ für denselben Stand: still nachgemeldet, nicht noch einmal gezeigt", async () => {
  window.localStorage.setItem(doneKey("person-a", confirmed.id), momentVersion(confirmed));
  const { queue, client } = enqueue([confirmed]);
  expect(queue.enqueue).not.toHaveBeenCalled();
  expect(client.post).toHaveBeenCalledWith("/me/league-moments/done", { ids: [confirmed.id] });
});

test("alte Marke plus korrigierter Moment mit derselben Kennung: der Moment erscheint, die Marke ist weg", () => {
  window.localStorage.setItem(doneKey("person-a", confirmed.id), momentVersion(confirmed));
  const { queue, client } = enqueue([corrected]);
  expect(queue.enqueue).toHaveBeenCalledTimes(1);
  expect(queue.enqueue.mock.calls[0][0].moments).toEqual([corrected]);
  expect(client.post).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(doneKey("person-a", confirmed.id))).toBeNull();
});

test("eine Marke der älteren Fassung ohne Stand gilt als veraltet - der Moment erscheint", () => {
  window.localStorage.setItem(doneKey("person-a", confirmed.id), "1");
  const { queue, client } = enqueue([confirmed]);
  expect(queue.enqueue).toHaveBeenCalledTimes(1);
  expect(client.post).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(doneKey("person-a", confirmed.id))).toBeNull();
});

test("nach dem Schließen hält die Marke den Stand des gezeigten Moments fest", async () => {
  const client = { post: vi.fn((url) => (url.endsWith("/done") ? Promise.reject(new Error("offline")) : Promise.resolve({ data: { claimed: [corrected.id] } }))) };
  const pkg = momentPackage(corrected, client, "person-a");
  await pkg.check();
  pkg.onDone();
  await waitFor(() => expect(window.localStorage.getItem(doneKey("person-a", corrected.id))).toBe(momentVersion(corrected)));
  expect(finishedHere("person-a", corrected)).toBe(true);
  expect(finishedHere("person-a", confirmed)).toBe(false);
});
