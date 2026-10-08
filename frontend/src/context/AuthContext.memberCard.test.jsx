import { act, render, waitFor } from "@testing-library/react";

// Abmelden löscht die gespeicherte Mitgliedskarte (#1256) - ebenso, wenn sich am selben Browser ein anderes Konto anmeldet.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { AuthProvider, useAuth } = await import("./AuthContext");
const { STORAGE_KEY, loadOfflineCard, saveOfflineCard } = await import("@/lib/memberCardOffline");

const CARD = { status: "valid", name: "LunaByte", member_number: "TLS-031", type_label: "Ordentliches Mitglied", member_since: "2024-03-01", valid_until: "2026-12-31", club_name: "THE LION SQUAD" };

let auth = null;
function Probe() {
  auth = useAuth();
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("Abmelden löscht die Karte", async () => {
  apiMock.get.mockResolvedValue({ data: { id: "u-luna", username: "lunabyte" }, headers: {} });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.user?.id).toBe("u-luna"));
  saveOfflineCard("u-luna", CARD);
  expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  await act(async () => { await auth.logout(); });
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(loadOfflineCard("u-luna")).toBeNull();
});

test("ein anderes Konto am selben Browser: die Karte des vorigen geht weg", async () => {
  saveOfflineCard("u-alt", CARD);
  apiMock.get.mockResolvedValue({ data: { id: "u-neu", username: "neonfalke" }, headers: {} });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.user?.id).toBe("u-neu"));
  await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
});
