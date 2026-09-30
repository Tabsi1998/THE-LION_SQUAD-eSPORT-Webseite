import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vorschau des Adventkalenders (#641): der Kalender zu einem gewählten Tag - ohne zu zählen, ohne Teilnahme; die
// Auflösung des Quiz kommt aus der Pflege, nicht vom Server.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "", formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => false, openSettings: () => {} }) }));

const { CalendarPreview } = await import("./CalendarPreview");

const QUIZ = { question: "Wie viele Kerzen?", answers: ["Drei", "Vier", "Fünf"], correct: 1, explanation: "Eine je Sonntag." };
const ADMIN_DOORS = [{ day: 2, door: { kind: "quiz", title: "Kranz-Quiz", quiz: QUIZ } }];

function calendar(today) {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const open = day <= today;
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: day * 11, state: open ? "opened" : "locked", ...(open ? { content: day === 2 ? { kind: "quiz", title: "Kranz-Quiz", body: "", media_url: null, link: null, quiz: { question: QUIZ.question, answers: QUIZ.answers, done: false } } : { kind: "text", title: `Inhalt ${day}`, body: "Text", media_url: null, link: null } } : {}) });
  }
  return { active: true, year: 2026, order: [], doors, catch_up: today > 24, newest_door: Math.min(24, today), opened: Math.min(24, today), total: 24, preview: true };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 30, 10), toFake: ["Date"] });
  apiMock.get.mockImplementation((_url, config) => Promise.resolve({ data: calendar(Number(config.params.at.slice(8, 10)) > 24 ? 30 : Number(config.params.at.slice(8, 10))) }));
});

afterEach(() => {
  vi.useRealTimers();
});

function show(props = {}) {
  const onClose = vi.fn();
  const view = render(<MemoryRouter><CalendarPreview year={2026} doors={ADMIN_DOORS} onClose={onClose} {...props} /></MemoryRouter>);
  return { onClose, ...view };
}

test("außerhalb des Advents beginnt die Vorschau am Heiligen Abend; ein anderer Tag lädt neu", async () => {
  show();
  expect(screen.getByRole("dialog", { name: "Vorschau Adventkalender 2026" })).toBeInTheDocument();
  await screen.findByTestId("advent-board");
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/advent/admin/2026/preview", { params: { at: "2026-12-24T09:00:00" }, skipInvalidation: true });
  expect(screen.getByTestId("advent-preview-moment")).toHaveValue("2026-12-24T09:00:00");
  expect(screen.getByTestId("advent-preview-moment").options).toHaveLength(25);
  expect(document.querySelectorAll("[data-state='opened']")).toHaveLength(24);

  fireEvent.change(screen.getByTestId("advent-preview-moment"), { target: { value: "2026-12-05T09:00:00" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/seasonal/advent/admin/2026/preview", { params: { at: "2026-12-05T09:00:00" }, skipInvalidation: true }));
  await waitFor(() => expect(document.querySelectorAll("[data-state='locked']")).toHaveLength(19));
  fireEvent.click(screen.getByTestId("advent-door-button-20"));
  expect(screen.getByTestId("advent-preview-note")).toHaveTextContent("Türchen 20 ist an diesem Tag noch verschlossen.");
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ein Klick zeigt den Inhalt; das Quiz löst aus der Pflege auf, ohne den Server zu fragen", async () => {
  show();
  await screen.findByTestId("advent-board");
  fireEvent.click(screen.getByTestId("advent-door-button-2"));
  expect(screen.getByRole("dialog", { name: "Kranz-Quiz" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("advent-quiz-answer-0"));
  expect(await screen.findByTestId("advent-quiz-result")).toHaveTextContent("Leider nein – richtig ist „Vier“. Eine je Sonntag.");
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(apiMock.get).toHaveBeenCalledTimes(1);
});

test("noch kein Türchen, Fehler beim Laden, schließen", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { active: false, next_start: "2026-12-01T00:00:00+01:00", reason: "empty", preview: true } });
  const first = show();
  expect(await screen.findByTestId("advent-preview-empty")).toHaveTextContent("Für 2026 ist noch kein Türchen angelegt");
  fireEvent.click(screen.getByTestId("advent-preview-close"));
  expect(first.onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(first.onClose).toHaveBeenCalledTimes(2);
  first.unmount();
  expect(document.body.style.overflow).toBe("");

  apiMock.get.mockRejectedValueOnce({ response: { data: { detail: "Diesen Zeitpunkt verstehe ich nicht." } } });
  show();
  expect(await screen.findByTestId("advent-preview-problem")).toHaveTextContent("Diesen Zeitpunkt verstehe ich nicht.");
});
