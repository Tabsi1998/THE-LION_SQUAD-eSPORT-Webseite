import { act, render, waitFor } from "@testing-library/react";

// Abmelden leert, was das Konto auf diesem Gerät hinterlässt: Konto, geteilte Ablage von Mein Bereich, gespeicherte
// Mitgliedskarte, letzte Suchen und die Browser-Benachrichtigungen (#2059). Scheitert /auth/logout, bleibt die Sitzung
// sichtbar - das Cookie gilt am Server weiter (public.spec: „logout keeps the visible session …“). Nach „Konto löschen“
// (`afterDelete`) hat der Server alle Sitzungen schon beendet: dann wird immer geleert, ohne zweite Meldung. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { AuthProvider, useAuth } = await import("./AuthContext");
const { STORAGE_KEY, saveOfflineCard } = await import("@/lib/memberCardOffline");
const { gemeinsamLaden, gemeinsamVergessen, istVerworfen } = await import("@/lib/gemeinsamLaden");

const CARD = { status: "valid", name: "Nachtfalke", member_number: "TLS-077", type_label: "Ordentliches Mitglied", member_since: "2025-02-01", valid_until: "2026-12-31", club_name: "THE LION SQUAD" };

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

async function angemeldetMitDaten() {
  apiMock.get.mockResolvedValue({ data: { id: "u-a", username: "nachtfalke" }, headers: {} });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.user?.id).toBe("u-a"));
  saveOfflineCard("u-a", CARD);
  window.localStorage.setItem("tls-recent-searches", JSON.stringify(["turnier"]));
  window.localStorage.setItem("tls-web-push-owner", "u-a");
  const anfrage = spaeter();
  apiMock.get.mockImplementationOnce(() => anfrage.promise);
  const rechnungen = gemeinsamLaden("/account/invoices", { konto: "u-a" });
  return { anfrage, rechnungen };
}

async function erwarteGeleert({ anfrage, rechnungen }) {
  expect(auth.user).toBeNull();
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(window.localStorage.getItem("tls-recent-searches")).toBeNull();
  expect(window.localStorage.getItem("tls-web-push-owner") || "").toBe("");
  anfrage.antworte({ data: { invoices: [{ ref: "RE-A-0001" }] } });
  expect(istVerworfen(await rechnungen.catch((err) => err))).toBe(true);
}

beforeEach(() => {
  window.localStorage.clear();
  gemeinsamVergessen();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.error.mockReset();
});

test("Abmelden ohne Netz: die Sitzung bleibt sichtbar, mit Meldung - nichts wird vorgetäuscht", async () => {
  await angemeldetMitDaten();
  apiMock.post.mockRejectedValue(new Error("Network Error"));
  let ergebnis;
  await act(async () => { ergebnis = await auth.logout(); });
  expect(ergebnis).toBe(false);
  expect(auth.user?.id).toBe("u-a");
  expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  expect(toastMock.error).toHaveBeenCalledTimes(1);
});

test("nach „Konto löschen“ (afterDelete) ohne Netz: Gerät leer, keine zweite Meldung", async () => {
  const laufend = await angemeldetMitDaten();
  apiMock.post.mockRejectedValue(new Error("Network Error"));
  let ergebnis;
  await act(async () => { ergebnis = await auth.logout({ afterDelete: true }); });
  expect(ergebnis).toBe(true);
  await erwarteGeleert(laufend);
  expect(toastMock.error).not.toHaveBeenCalled();
});

test("Abmelden mit Netz: dasselbe, ohne Meldung", async () => {
  const laufend = await angemeldetMitDaten();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  let ergebnis;
  await act(async () => { ergebnis = await auth.logout(); });
  expect(ergebnis).toBe(true);
  await erwarteGeleert(laufend);
  expect(toastMock.error).not.toHaveBeenCalled();
});
