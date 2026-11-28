import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Plan A/B/C beim Ort (#2613) und Abstimmungen (#2612) in der Verwaltung: Pläne beim Ort statt der Ortsfelder, Umschalten
// mit einem Klick und der Frage „Angemeldete informieren?“, ein eigener Abschnitt „Abstimmungen“ mit Zahlen statt Namen
// und „Als Ort übernehmen“, wenn die Antworten die Pläne sind.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, formatApiError: (detail) => detail || "", resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/DiscordPreview", () => ({ DiscordPreview: () => null }));
vi.mock("@/components/tls/SharePreviewToggle", () => ({ SharePreviewToggle: () => null }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => null }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => null }));
vi.mock("@/components/tls/EventBillingSection", () => ({ EventBillingSection: () => null }));
vi.mock("@/components/tls/RichContent", () => ({ appendEmbedToken: (text) => text }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const AdminEventEditPage = (await import("./AdminEventEditPage")).default;
const { toast } = await import("sonner");

const PLANS = [
  { key: "plan-a", label: "Plan A", letter: "A", name: "Rodelbahn Hochegg", address: "Hocheggweg 1", postal_code: "6410", city: "Telfs", country: "Österreich", note: "", active: true },
  { key: "plan-b", label: "Plan B", letter: "B", name: "Rodelbahn Gaisalm", address: "Gaisweg 5", postal_code: "6410", city: "Telfs", country: "Österreich", note: "Bei wenig Schnee", active: false },
];
const EVENT = {
  id: "ev-1", name: "Silvesterparty", slug: "silvester", status: "registration_open", event_type: "general", visibility: "public",
  start_date: "2026-12-31T17:00:00Z", location: "Rodelbahn Hochegg", address: "Hocheggweg 1", postal_code: "6410", city: "Telfs", country: "Österreich",
  active_registration_count: 3, place_plans: PLANS, place_plan: { ...PLANS[0], total: 2, alternative: false }, active_place_plan: "plan-a", place_plan_history: [],
};
const POLL = {
  id: "p1", question: "Welcher Ort?", options: [{ code: "plan-a", label: "Plan A: Rodelbahn Hochegg" }, { code: "plan-b", label: "Plan B: Rodelbahn Gaisalm" }],
  max_choices: 1, status: "closed", closes_at: "2026-12-20T17:00:00Z", results_visibility: "after_close", voters_count: 3, eligible_count: 3, place_plan_poll: true,
  result: { outcome_label: "Mehrheit", winner: "plan-b", winner_label: "Plan B: Rodelbahn Gaisalm", valid: 3,
    counts: [{ code: "plan-a", label: "Plan A: Rodelbahn Hochegg", count: 1 }, { code: "plan-b", label: "Plan B: Rodelbahn Gaisalm", count: 2 }] },
};

let current = EVENT;
function renderAt(path = "/admin/events/ev-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/events" element={<div data-testid="events-list" />} />
        <Route path="/admin/events/new" element={<AdminEventEditPage />} />
        <Route path="/admin/events/:id" element={<AdminEventEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  current = EVENT;
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: { types: [], statuses: [], visibilities: [] } };
    if (url === "/admin/events/ev-1") return { data: current };
    if (url === "/admin/events/ev-1/polls") return { data: [POLL] };
    return { data: [] };
  });
});

test("Pläne ersetzen die Ortsfelder; Umschalten fragt, ob die Angemeldeten es erfahren", async () => {
  apiMock.post.mockImplementation(async (url) => {
    current = { ...EVENT, active_place_plan: "plan-b", place_plan: { ...PLANS[1], total: 2, alternative: true },
      place_plan_history: [{ at: "2026-12-28T17:00:00Z", from_label: "Plan A", to_label: "Plan B", actor_name: "Leitung", notified: 3 }] };
    return { data: { changed: true, notice: { notified: 3 } }, url };
  });
  renderAt();
  const section = await screen.findByTestId("event-place-plans-admin");
  expect(screen.queryByTestId("event-location-name")).toBeNull();
  expect(within(section).getByTestId("event-place-plan-active-0")).toHaveTextContent("Gilt jetzt");
  fireEvent.click(within(section).getByTestId("event-place-plan-switch-1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/events/ev-1/place-plan", { key: "plan-b", notify: true, expected: "plan-a" }));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Angemeldete informieren?", cancelLabel: "Ohne Nachricht umschalten" }));
  expect(await within(section).findByTestId("event-place-plan-active-1")).toHaveTextContent("Gilt jetzt");
  expect(toast.success).toHaveBeenCalledWith("Plan B gilt jetzt. 3 Personen informiert.");
  expect(within(section).getByTestId("event-place-plans-history")).toHaveTextContent("Plan A → Plan B · Leitung · 3 informiert");
});

test("ungespeicherte Pläne: erst speichern, dann umschalten; ein neuer aktiver Ort fragt beim Speichern", async () => {
  apiMock.patch.mockResolvedValue({ data: EVENT });
  renderAt();
  const section = await screen.findByTestId("event-place-plans-admin");
  fireEvent.change(within(section).getByTestId("event-place-plan-address-0"), { target: { value: "Hocheggweg 3" } });
  expect(within(section).getByTestId("event-place-plan-switch-1")).toBeDisabled();
  expect(within(section).getByTestId("event-place-plans-save-first")).toBeInTheDocument();
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [, patch] = apiMock.patch.mock.calls[0];
  expect(patch.place_plans[0]).toMatchObject({ key: "plan-a", address: "Hocheggweg 3" });
  expect(patch.notify_registrants).toBe(true);
});

test("ein Ausweichort beginnt mit dem eingetragenen Ort als Plan A", async () => {
  current = { ...EVENT, place_plans: [], place_plan: null, active_place_plan: null };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/events/ev-1") return { data: current };
    return { data: [] };
  });
  apiMock.patch.mockResolvedValue({ data: current });
  renderAt();
  fireEvent.click(await screen.findByTestId("event-place-plans-start"));
  const section = screen.getByTestId("event-place-plans-admin");
  expect(within(section).getByTestId("event-place-plan-name-0")).toHaveValue("Rodelbahn Hochegg");
  expect(within(section).queryByTestId("event-place-plan-switch-1")).toBeNull();
  fireEvent.change(within(section).getByTestId("event-place-plan-name-1"), { target: { value: "Vereinsheim" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [, patch] = apiMock.patch.mock.calls[0];
  expect(patch.place_plans.map((plan) => plan.name)).toEqual(["Rodelbahn Hochegg", "Vereinsheim"]);
  // Plan A ist der Ort, der schon galt - das ist keine Ortsänderung, also keine Frage.
  expect(patch).not.toHaveProperty("notify_registrants");
});

test("Abstimmungen: Zahlen statt Namen, Ergebnis als Ort übernehmen", async () => {
  apiMock.post.mockResolvedValue({ data: { changed: true, notice: null } });
  confirmMock.mockResolvedValueOnce(false);
  renderAt();
  const poll = await screen.findByTestId("event-poll-admin-p1");
  expect(within(poll).getByTestId("event-poll-admin-p1-turnout")).toHaveTextContent("3 von 3 abgestimmt");
  expect(within(poll).getByTestId("event-poll-admin-p1-result-plan-b")).toHaveAttribute("data-winner", "1");
  fireEvent.click(within(poll).getByTestId("event-poll-admin-p1-take-over"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/events/ev-1/place-plan", { key: "plan-b", notify: false, expected: "plan-a" }));
});

test("neue Abstimmung: Frage, Antworten, Frist, mehrere Antworten und Nachricht", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "p2", notice: { notified: 2 } } });
  renderAt();
  await screen.findByTestId("event-poll-admin-p1");
  fireEvent.click(screen.getByTestId("event-poll-new"));
  const form = screen.getByTestId("event-poll-form");
  expect(within(form).getByTestId("event-poll-save")).toBeDisabled();
  fireEvent.change(within(form).getByTestId("event-poll-question"), { target: { value: "Garage oder Garten?" } });
  fireEvent.change(within(form).getByTestId("event-poll-option-0"), { target: { value: "Garage" } });
  fireEvent.change(within(form).getByTestId("event-poll-option-1"), { target: { value: "garage" } });
  expect(within(form).getByTestId("event-poll-form-error")).toHaveTextContent("doppelt");
  fireEvent.change(within(form).getByTestId("event-poll-option-1"), { target: { value: "Garten" } });
  fireEvent.click(within(form).getByTestId("event-poll-option-add"));
  fireEvent.change(within(form).getByTestId("event-poll-option-2"), { target: { value: "Beides" } });
  fireEvent.click(within(form).getByTestId("event-poll-multiple"));
  fireEvent.change(within(form).getByTestId("event-poll-results"), { target: { value: "after_close" } });
  fireEvent.click(within(form).getByTestId("event-poll-notify"));
  fireEvent.click(within(form).getByTestId("event-poll-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/events/ev-1/polls", {
    question: "Garage oder Garten?", options: [{ label: "Garage" }, { label: "Garten" }, { label: "Beides" }], max_choices: 2,
    closes_at: null, results_visibility: "after_close", notify: true,
  }));
  expect(toast.success).toHaveBeenCalledWith("Abstimmung angelegt, 2 informiert.");
});

test("über die Ort-Pläne abstimmen: je Plan eine Antwort mit dem Schlüssel des Plans", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "p3", notice: null } });
  renderAt();
  await screen.findByTestId("event-poll-admin-p1");
  fireEvent.click(screen.getByTestId("event-poll-new-plans"));
  const form = screen.getByTestId("event-poll-form");
  expect(within(form).getByTestId("event-poll-option-1")).toHaveValue("Plan B: Rodelbahn Gaisalm");
  fireEvent.click(within(form).getByTestId("event-poll-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/events/ev-1/polls", expect.objectContaining({
    question: "Welcher Ort?", options: [{ code: "plan-a", label: "Plan A: Rodelbahn Hochegg" }, { code: "plan-b", label: "Plan B: Rodelbahn Gaisalm" }],
  })));
});
