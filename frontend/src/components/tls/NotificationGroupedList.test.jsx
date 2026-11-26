import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationGroupedList } from "./NotificationGroupedList";

// Glocke und Postfach aufgeräumt (#1205): Tage, Themen zum Antippen, gebündelte Ergebnisse, Symbol statt Kennwort und
// neue Meldungen, die bei offener Liste hineingleiten.

const HOUR = 60 * 60 * 1000;
const at = (hours) => new Date(Date.now() - hours * HOUR).toISOString();
const result = (id, hours) => ({ id, kind: "match_result", topic: "match_reminders", importance: "normal", title: "Ergebnis bestätigt",
  body: "Liga 1: A 1:0 B", meta: { tournament_id: "liga-1", tournament_title: "Liga 1" }, read: false, created_at: at(hours) });
const rows = [
  { ...result("r1", 0.01) }, { ...result("r2", 0.02) }, { ...result("r3", 0.03) },
  { id: "call", kind: "match_call", topic: "match_reminders", importance: "urgent", title: "Du bist dran", body: "", meta: {}, read: false, created_at: at(0.005) },
  { id: "inv", kind: "invoice_ready", topic: "billing_updates", importance: "important", title: "Deine Rechnung ist da", body: "", meta: {}, read: true, created_at: at(24 * 5) },
];

const view = (list, props = {}) => (
  <MemoryRouter><NotificationGroupedList rows={list} onOpen={() => {}} onDelete={() => {}} pendingIds={new Set()} {...props} /></MemoryRouter>
);

test("gliedert nach Tagen und bündelt die Ergebnisse eines Turniers", () => {
  render(view(rows));
  const today = screen.getByTestId("notification-groups-day-today");
  expect(within(today).getByRole("heading", { name: "Heute" })).toBeInTheDocument();
  expect(within(today).getByText("3 neue Ergebnisse in Liga 1")).toBeInTheDocument();
  expect(within(screen.getByTestId("notification-groups-day-earlier")).getByText("Deine Rechnung ist da")).toBeInTheDocument();
  // Symbol und Klartext statt Kennwort; Dringendes ist für Screenreader benannt.
  expect(screen.queryByText("MATCH_CALL")).toBeNull();
  expect(screen.getByText("Dringend, Spiele & Aufrufe")).toBeInTheDocument();
});

test("ein Thema antippen filtert, „Alle“ zeigt wieder alles", () => {
  render(view(rows));
  fireEvent.click(screen.getByTestId("notification-groups-topic-billing_updates"));
  expect(screen.getByTestId("notification-groups-topic-billing_updates")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("3 neue Ergebnisse in Liga 1")).toBeNull();
  expect(screen.getByText("Deine Rechnung ist da")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("notification-groups-topic-all"));
  expect(screen.getByText("3 neue Ergebnisse in Liga 1")).toBeInTheDocument();
});

test("nur was bei offener Liste dazukommt, gleitet hinein", () => {
  const { rerender, container } = render(view(rows));
  expect(container.querySelectorAll('[data-fresh="true"]')).toHaveLength(0);
  const fresh = { id: "new", kind: "tournament_pause", topic: "tournament_updates", importance: "important", title: "Pause bis 14:30",
    body: "", meta: {}, read: false, created_at: new Date().toISOString() };
  rerender(view([fresh, ...rows]));
  const glide = container.querySelectorAll('[data-fresh="true"]');
  expect(glide).toHaveLength(1);
  expect(within(glide[0]).getByText("Pause bis 14:30")).toBeInTheDocument();
});

test("ein leeres Thema sagt es, ohne Themen-Leiste bei nur einem Thema", () => {
  render(view([rows[4]], { tab: "unread", emptyText: "Keine ungelesenen Benachrichtigungen." }));
  expect(screen.queryByTestId("notification-groups-topics")).toBeNull();
  expect(screen.getByText("Keine ungelesenen Benachrichtigungen.")).toBeInTheDocument();
});
