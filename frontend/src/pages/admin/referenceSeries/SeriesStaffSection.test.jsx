import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Captains der Saison (#1749): der Vorstand sieht Ablauf, Veröffentlichen-Recht und fehlende Zwei-Faktor-Anmeldung,
// fügt per Personensuche mit Pflicht-Ablauf hinzu, schaltet das Recht um und entfernt - alles über den Server.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Die Personensuche hat eigene Tests - hier reicht ein Knopf, der eine Person wählt.
vi.mock("@/components/tls/PersonPicker", () => ({
  PersonAvatar: () => <span />,
  PersonPicker: ({ value, onChange, testId }) => (
    value ? <div data-testid={`${testId}-chosen`}>{value.name}</div>
      : <button type="button" data-testid={`${testId}-choose`} onClick={() => onChange({ id: "u-2", name: "Probe Pia" })}>wählen</button>
  ),
}));

const { SeriesStaffSection } = await import("./SeriesStaffSection");

const SERIES = { id: "serie-1", publish_mode: "review" };
const ACTIVE = { id: "st-1", user_id: "u-1", name: "Captain Carla", valid_until: "2026-12-31", is_valid: true, can_publish: false, publishes_directly: false, mfa_enabled: true, account_active: true, is_member: true };
const EXPIRED = { id: "st-2", user_id: "u-3", name: "Alter Albert", valid_until: "2026-01-31", is_valid: false, can_publish: true, publishes_directly: true, mfa_enabled: false, account_active: true, is_member: false };

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: { staff: [ACTIVE, EXPIRED], publish_mode: "review" } });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

test("Liste: Ablauf, Entwurf oder direkt, fehlende Zwei-Faktor-Anmeldung und Mitgliedschaft", async () => {
  render(<SeriesStaffSection series={SERIES} />);
  expect(await screen.findByTestId("series-staff-validity-st-1")).toHaveTextContent("gilt bis 31.12.2026 · Einträge sind Entwürfe, der Vorstand gibt frei");
  expect(screen.getByTestId("series-staff-validity-st-2")).toHaveTextContent("abgelaufen am 31.01.2026 · veröffentlicht direkt");
  expect(screen.getByTestId("series-staff-mfa-st-2")).toHaveTextContent("Zwei-Faktor fehlt");
  expect(screen.queryByTestId("series-staff-mfa-st-1")).toBeNull();
  expect(screen.getByTestId("series-staff-member-st-2")).toHaveTextContent("Kein aktives Vereinsmitglied mehr");
  expect(screen.queryByTestId("series-staff-member-st-1")).toBeNull();
  expect(screen.getByTestId("series-staff-mode")).toHaveTextContent("Entwürfe, die der Vorstand freigibt");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/staff");
});

test("Hinzufügen geht erst mit Person und Ablauf und schickt beides samt Recht", async () => {
  render(<SeriesStaffSection series={SERIES} />);
  await screen.findByTestId("series-staff-list");
  expect(screen.getByTestId("series-staff-submit")).toBeDisabled();
  fireEvent.click(screen.getByTestId("series-staff-person-choose"));
  expect(screen.getByTestId("series-staff-submit")).toBeDisabled();
  fireEvent.change(screen.getByTestId("series-staff-new-until"), { target: { value: "2026-12-31" } });
  fireEvent.click(screen.getByTestId("series-staff-new-publish"));
  fireEvent.click(screen.getByTestId("series-staff-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/staff", { user_id: "u-2", valid_until: "2026-12-31", can_publish: true }));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
});

test("Recht umschalten, Ablauf ändern und entfernen gehen an genau diesen Captain", async () => {
  render(<SeriesStaffSection series={SERIES} />);
  await screen.findByTestId("series-staff-list");
  fireEvent.click(screen.getByTestId("series-staff-publish-st-1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/staff/st-1", { can_publish: true }));

  expect(screen.queryByTestId("series-staff-until-save-st-1")).toBeNull();
  fireEvent.change(screen.getByTestId("series-staff-until-st-1"), { target: { value: "2027-03-31" } });
  fireEvent.click(screen.getByTestId("series-staff-until-save-st-1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/staff/st-1", { valid_until: "2027-03-31" }));

  fireEvent.click(screen.getByTestId("series-staff-remove-st-2"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/staff/st-2"));
});

test("ohne Captain ein Satz statt einer leeren Liste; direkte Saison sagt es", async () => {
  apiMock.get.mockResolvedValue({ data: { staff: [], publish_mode: "direct" } });
  render(<SeriesStaffSection series={{ ...SERIES, publish_mode: "direct" }} />);
  expect(await screen.findByTestId("series-staff-empty")).toHaveTextContent("Noch kein Captain");
  expect(screen.getByTestId("series-staff-mode")).toHaveTextContent("veröffentlichen alle Captains direkt");
});
