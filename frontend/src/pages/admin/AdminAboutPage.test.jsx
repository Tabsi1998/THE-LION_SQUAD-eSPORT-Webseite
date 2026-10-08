import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Über uns pflegen (#406): die Texte kommen ins Formular, Speichern schickt Texte, Listen (eine je
// Zeile) und die Vereins-Rückfallfelder; kommen die Vereinsdaten aus Dolibarr, sind Gründung und
// gemeinnützig gesperrt.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ value, onChange, testId }) => <input data-testid={testId} value={value || ""} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminAboutPage, foundedLabel, moveRow, textsToForm, formToPayload } = await import("./AdminAboutPage");

const TEXTS = {
  hero_eyebrow: "Über uns", hero_title: "Ein Rudel.", hero_text: "Text", values_title: "Werte", values_text: "V", games_title: "Spiele", games_text: "G", offline_title: "Offline", offline_text: "O",
  offline_items: ["Grillen"], cta_title: "CTA", cta_text: "C", founded_year: 2019, purpose: "Zweck", nonprofit: true,
  values: [{ title: "Fairplay", text: "Wir gratulieren auch.", example: "GG" }], goals: ["**Heimat** schaffen"],
  timeline: [{ year: "2023", title: "Gründung", text: "Sieben Leute.", image_url: "" }], club_photo: { url: "/api/static/uploads/team.jpg", focus_x: 40, focus_y: 60 },
};

function mockApi(organization, texts = TEXTS) {
  apiMock.get.mockResolvedValue({ data: { texts, defaults: {}, organization, numbers: { members: 3 }, games: 2, offline_events: 1 } });
  apiMock.put.mockReset();
  apiMock.put.mockResolvedValue({ data: { ok: true, texts: { ...TEXTS, hero_title: "Neu" } } });
}

test("lädt die Texte, Speichern schickt Texte, Listen und Rückfallfelder", async () => {
  mockApi({ source: "manual" });
  render(<MemoryRouter><AdminAboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-hero-title")).toHaveValue("Ein Rudel.");
  expect(screen.getByTestId("about-value-title-0")).toHaveValue("Fairplay");
  expect(screen.getByTestId("about-timeline-year-0")).toHaveValue("2023");
  expect(screen.getByTestId("about-club-photo-upload")).toHaveValue("/api/static/uploads/team.jpg");
  expect(screen.getByTestId("about-founded-year")).toHaveValue("2019");
  expect(screen.getByTestId("about-founded-year")).not.toBeDisabled();
  expect(screen.getByTestId("about-numbers-picker")).toHaveTextContent("3");

  fireEvent.change(screen.getByTestId("about-hero-title"), { target: { value: "Neu" } });
  fireEvent.click(screen.getByTestId("about-value-add"));
  fireEvent.change(screen.getByTestId("about-value-title-1"), { target: { value: " Mut " } });
  fireEvent.change(screen.getByTestId("about-value-text-1"), { target: { value: "Wir trauen uns was." } });
  fireEvent.click(screen.getByTestId("about-timeline-add"));
  fireEvent.change(screen.getByTestId("about-timeline-year-1"), { target: { value: "2024" } });
  fireEvent.change(screen.getByTestId("about-timeline-title-1"), { target: { value: "Erste LAN" } });
  fireEvent.click(screen.getByRole("button", { name: "Eintrag 2 nach oben" }));
  fireEvent.change(screen.getByTestId("about-goals"), { target: { value: "**Heimat** schaffen\n\n Nachwuchs " } });
  fireEvent.submit(screen.getByTestId("about-form"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.put.mock.calls[0];
  expect(url).toBe("/home/about/admin");
  expect(payload).toEqual(expect.objectContaining({ hero_title: "Neu", offline_items: ["Grillen"], founded_year: 2019, nonprofit: true, purpose: "Zweck", numbers_shown: ["prizes", "tournaments_completed", "members", "years_active"] }));
  expect(payload.values).toEqual([{ title: "Fairplay", text: "Wir gratulieren auch.", example: "GG" }, { title: "Mut", text: "Wir trauen uns was.", example: "" }]);
  expect(payload.timeline.map((entry) => entry.year)).toEqual(["2024", "2023"]);
  expect(payload.goals).toEqual(["**Heimat** schaffen", "Nachwuchs"]);
  expect(payload.club_photo).toEqual({ url: "/api/static/uploads/team.jpg", focus_x: 40, focus_y: 60 });
  expect(payload).not.toHaveProperty("pillars");
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
});

test("Zahlen wählen und ordnen (#621): Häkchen, Pfeile, Preisgeld im Hinweis", async () => {
  mockApi({ source: "manual" });
  apiMock.get.mockResolvedValue({ data: { texts: { ...TEXTS, numbers_shown: ["members", "prizes"] }, defaults: {}, organization: { source: "manual" }, numbers: { members: 3, prizes: 4, prize_money_eur: 120.5, years_active: 0 }, games: 2, offline_events: 1 } });
  render(<MemoryRouter><AdminAboutPage /></MemoryRouter>);
  const picker = await screen.findByTestId("about-numbers-picker");
  expect(picker).toHaveTextContent("4 (120,5 € Preisgeld)");
  expect(picker).toHaveTextContent("0 – Gründungsjahr fehlt");
  expect(screen.getByTestId("about-number-members-toggle")).toBeChecked();
  expect(screen.getByTestId("about-number-events-toggle")).not.toBeChecked();
  fireEvent.click(screen.getByTestId("about-number-prizes-up"));
  fireEvent.click(screen.getByTestId("about-number-events-toggle"));
  fireEvent.submit(screen.getByTestId("about-form"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
  expect(apiMock.put.mock.calls[0][1].numbers_shown).toEqual(["prizes", "members", "events"]);
});

test("mit Vereinsdaten aus Dolibarr sind Gründung und gemeinnützig gesperrt", async () => {
  mockApi({ source: "dolibarr", founded_year: 2021, nonprofit: true, purpose: "Aus Dolibarr" });
  render(<MemoryRouter><AdminAboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-organization-dolibarr")).toHaveTextContent("gegründet 2021");
  expect(screen.getByTestId("about-founded-year")).toBeDisabled();
  expect(screen.getByTestId("about-nonprofit")).toBeDisabled();
});

test("Formular-Umwandlung", () => {
  const form = textsToForm({ values: [{ title: "A" }], founded_year: null, nonprofit: null });
  expect(form.values).toEqual([{ title: "A", text: "", example: "" }]);
  expect(form.club_photo).toEqual({ url: "", focus_x: 50, focus_y: 50 });
  expect(formToPayload(form).club_photo).toBeNull();
  expect(formToPayload({ ...form, timeline: [{ year: "2024", title: "", text: "", image_url: "" }] }).timeline).toEqual([]);
  expect(moveRow(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
  expect(moveRow(["a"], 0, -1)).toEqual(["a"]);
  expect(form.founded_year).toBe("");
  expect(formToPayload({ ...form, founded_year: "19" }).founded_year).toBeNull();
  expect(formToPayload({ ...form, founded_year: "2019" }).founded_year).toBe(2019);
});

test("Gründungsdatum (#644): leer löscht, ein Tag geht mit, das Jahr folgt daraus und ist dann gesperrt", async () => {
  const form = textsToForm({ founded_year: 2019, founded_on: null });
  expect(form.founded_on).toBe("");
  expect(formToPayload(form).founded_on).toBe("");
  expect(formToPayload({ ...form, founded_on: "2019-03-01" }).founded_on).toBe("2019-03-01");
  expect(formToPayload({ ...form, founded_on: "1.3.2019" }).founded_on).toBe("");
  expect(foundedLabel("2019-03-01")).toBe("1. März 2019");
  expect(foundedLabel("")).toBe("");

  mockApi({ source: "manual" }, { ...TEXTS, founded_on: "2019-03-01" });
  render(<MemoryRouter><AdminAboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-founded-on")).toHaveValue("2019-03-01");
  expect(screen.getByTestId("about-founded-year")).toHaveValue("2019");
  expect(screen.getByTestId("about-founded-year")).toBeDisabled();
  fireEvent.change(screen.getByTestId("about-founded-on"), { target: { value: "" } });
  expect(screen.getByTestId("about-founded-year")).not.toBeDisabled();
});
