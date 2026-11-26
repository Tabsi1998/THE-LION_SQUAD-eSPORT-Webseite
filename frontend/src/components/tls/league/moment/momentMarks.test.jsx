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
  await waitFor(() => expect(finishedHere("person-a", "m-up")).toBe(true));
  expect(finishedHere("person-b", "m-up")).toBe(false);
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
  await waitFor(() => expect(finishedHere("person-a", "m-up")).toBe(true));
  await act(async () => { await auth.logout(); });
  expect(finishedHere("person-a", "m-up")).toBe(false);
  expect(Object.keys(window.localStorage).filter((key) => key.startsWith("tls_moment_"))).toEqual([]);
});
