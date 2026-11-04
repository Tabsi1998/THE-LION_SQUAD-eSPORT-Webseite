import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DutyAttention, hasDutyAttention } from "./DutyAttention";

// „Braucht deine Entscheidung“ (#2194): nach dem Ende noch „Live“ und überfällige Liga-Spiele, je mit Weg dorthin.

const DUTY = {
  ended_live: [
    { id: "t1", title: "Herbst-Cup", end_date: "2026-10-31T22:00:00Z", open_matches: 0, admin_url: "/admin/tournaments/t1" },
    { id: "t2", title: "Langer Cup", end_date: "2026-10-31T22:00:00Z", open_matches: 3, admin_url: "/admin/tournaments/t2" },
  ],
  overdue_matches: [{ match_id: "m1", title: "Liga · Staffel A", label: "Spieltag 2", scheduled_at: "2026-11-01T19:00:00Z", url: "/matches/m1" }],
  // Check-in abgelaufen (#1652): eine Seite fehlt - die Leitung entscheidet, gewertet wird nichts von selbst.
  checkin_proposals: [{ match_id: "m2", title: "Liga · Staffel A", label: "Spieltag 3", due_at: "2026-11-08T19:15:00Z", missing: ["Falken · Horst"],
    url: "/matches/m2", lead_url: "/tournaments/staffel-a/leitung?fall=ns-m2" }],
};

test("zeigt alle Arten mit Satz und Weg", () => {
  render(<MemoryRouter><DutyAttention duty={DUTY} /></MemoryRouter>);
  expect(screen.getByTestId("duty-checkin-m2")).toHaveTextContent("Check-in abgelaufen: Spieltag 3");
  expect(screen.getByTestId("duty-checkin-m2")).toHaveTextContent("Falken · Horst nicht eingecheckt, Fenster bis So 08.11. 20:15");
  expect(screen.getByTestId("duty-checkin-open-m2")).toHaveAttribute("href", "/tournaments/staffel-a/leitung?fall=ns-m2");
  expect(screen.getByTestId("duty-ended-t1")).toHaveTextContent("alle Spiele sind fertig");
  expect(screen.getByTestId("duty-ended-open-t1")).toHaveTextContent("Beenden");
  expect(screen.getByTestId("duty-ended-open-t1")).toHaveAttribute("href", "/admin/tournaments/t1");
  expect(screen.getByTestId("duty-ended-t2")).toHaveTextContent("3 Spiele sind noch offen");
  expect(screen.getByTestId("duty-overdue-m1")).toHaveTextContent("Überfällig: Spieltag 2");
  expect(screen.getByTestId("duty-overdue-m1")).toHaveTextContent("So 01.11. 20:00");
  expect(screen.getByTestId("duty-overdue-open-m1")).toHaveAttribute("href", "/matches/m1");
});

test("ohne Fälle nichts", () => {
  expect(hasDutyAttention({ ended_live: [], overdue_matches: [], checkin_proposals: [] })).toBe(false);
  expect(hasDutyAttention({ checkin_proposals: [{ match_id: "m2" }] })).toBe(true);
  expect(hasDutyAttention(null)).toBe(false);
  const { container } = render(<MemoryRouter><DutyAttention duty={{}} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
