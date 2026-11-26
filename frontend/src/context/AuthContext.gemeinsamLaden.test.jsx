import { act, render, waitFor } from "@testing-library/react";

// Abmelden und Kontowechsel leeren die geteilte Ablage von „Mein Bereich“ (Prüfung #2059): eine Antwort, die für das
// vorige Konto noch unterwegs war, kommt nicht mehr an. Erfundene Konten.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { AuthProvider, useAuth } = await import("./AuthContext");
const { gemeinsamLaden, gemeinsamVergessen, istVerworfen } = await import("@/lib/gemeinsamLaden");

let auth = null;
function Probe() {
  auth = useAuth();
  return null;
}

function spaeter() {
  let antworte;
  const promise = new Promise((resolve) => { antworte = resolve; });
  return { promise, antworte };
}

beforeEach(() => {
  gemeinsamVergessen();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("Abmelden: die Rechnungen, die für das Konto noch unterwegs waren, werden verworfen", async () => {
  apiMock.get.mockResolvedValue({ data: { id: "u-a", username: "nachtfalke" }, headers: {} });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.user?.id).toBe("u-a"));
  const anfrage = spaeter();
  apiMock.get.mockImplementationOnce(() => anfrage.promise);
  const rechnungen = gemeinsamLaden("/account/invoices", { konto: "u-a" });
  await act(async () => { await auth.logout(); });
  anfrage.antworte({ data: { invoices: [{ ref: "RE-A-0001" }] } });
  expect(istVerworfen(await rechnungen.catch((err) => err))).toBe(true);
});

test("Sitzung weg ohne Abmelden (Konto null): auch dann verfällt die Antwort", async () => {
  apiMock.get.mockResolvedValue({ data: { id: "u-a", username: "nachtfalke" }, headers: {} });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.user?.id).toBe("u-a"));
  const anfrage = spaeter();
  apiMock.get.mockImplementationOnce(() => anfrage.promise);
  const rechnungen = gemeinsamLaden("/account/invoices", { konto: "u-a" });
  act(() => { auth.setUser(null); });
  anfrage.antworte({ data: { invoices: [] } });
  expect(istVerworfen(await rechnungen.catch((err) => err))).toBe(true);
});
