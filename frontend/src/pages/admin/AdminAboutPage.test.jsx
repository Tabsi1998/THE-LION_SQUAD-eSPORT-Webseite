import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Über uns pflegen (#406): die Texte kommen ins Formular, Speichern schickt Texte, Listen (eine je
// Zeile) und die Vereins-Rückfallfelder; kommen die Vereinsdaten aus Dolibarr, sind Gründung und
// gemeinnützig gesperrt.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminAboutPage, textsToForm, formToPayload } = await import("./AdminAboutPage");

const TEXTS = { hero_eyebrow: "Der Verein", hero_title: "Ein Rudel.", hero_text: "Text", values_title: "Werte", values_text: "V", pillars: ["Fairplay", "Spaß"], games_title: "Spiele", games_text: "G", offline_title: "Offline", offline_text: "O", offline_items: ["Grillen"], cta_title: "CTA", cta_text: "C", founded_year: 2019, purpose: "Zweck", nonprofit: true };

function mockApi(organization) {
  apiMock.get.mockResolvedValue({ data: { texts: TEXTS, defaults: {}, organization, numbers: { members: 3 }, games: 2, offline_events: 1 } });
  apiMock.put.mockReset();
  apiMock.put.mockResolvedValue({ data: { ok: true, texts: { ...TEXTS, hero_title: "Neu" } } });
}

test("lädt die Texte, Speichern schickt Texte, Listen und Rückfallfelder", async () => {
  mockApi({ source: "manual" });
  render(<MemoryRouter><AdminAboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-hero-title")).toHaveValue("Ein Rudel.");
  expect(screen.getByTestId("about-pillars")).toHaveValue("Fairplay\nSpaß");
  expect(screen.getByTestId("about-founded-year")).toHaveValue("2019");
  expect(screen.getByTestId("about-founded-year")).not.toBeDisabled();
  expect(screen.getByTestId("about-live-data")).toHaveTextContent("3");

  fireEvent.change(screen.getByTestId("about-hero-title"), { target: { value: "Neu" } });
  fireEvent.change(screen.getByTestId("about-pillars"), { target: { value: "Fairplay\n\n Mut " } });
  fireEvent.submit(screen.getByTestId("about-form"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.put.mock.calls[0];
  expect(url).toBe("/home/about/admin");
  expect(payload).toEqual(expect.objectContaining({ hero_title: "Neu", pillars: ["Fairplay", "Mut"], offline_items: ["Grillen"], founded_year: 2019, nonprofit: true, purpose: "Zweck" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
});

test("mit Vereinsdaten aus Dolibarr sind Gründung und gemeinnützig gesperrt", async () => {
  mockApi({ source: "dolibarr", founded_year: 2021, nonprofit: true, purpose: "Aus Dolibarr" });
  render(<MemoryRouter><AdminAboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-organization-dolibarr")).toHaveTextContent("gegründet 2021");
  expect(screen.getByTestId("about-founded-year")).toBeDisabled();
  expect(screen.getByTestId("about-nonprofit")).toBeDisabled();
});

test("Formular-Umwandlung", () => {
  const form = textsToForm({ pillars: ["A"], founded_year: null, nonprofit: null });
  expect(form.pillars).toBe("A");
  expect(form.founded_year).toBe("");
  expect(formToPayload({ ...form, founded_year: "19" }).founded_year).toBeNull();
  expect(formToPayload({ ...form, founded_year: "2019" }).founded_year).toBe(2019);
});
