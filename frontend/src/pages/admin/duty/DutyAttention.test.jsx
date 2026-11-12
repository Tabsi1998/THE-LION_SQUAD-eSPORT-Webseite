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
  rules_pending: [
    { league_id: "l1", league_name: "Probe-Liga", season_id: "s1", season_name: "Season 1", kind: "changed", count: 3, label: "Version 2", admin_url: "/admin/leagues/rules/league_season/s1" },
    { league_id: "l1", league_name: "Probe-Liga", season_id: "s2", season_name: "Season 2", kind: "draft", count: 0, label: null, admin_url: "/admin/leagues/rules/league/l1" },
  ],
  // Check-in abgelaufen (#1652): eine Seite fehlt - die Leitung entscheidet, gewertet wird nichts von selbst.
  checkin_proposals: [{ match_id: "m2", title: "Liga · Staffel A", label: "Spieltag 3", due_at: "2026-11-08T19:15:00Z", missing: ["Falken · Horst"],
    url: "/matches/m2", lead_url: "/tournaments/staffel-a/leitung?fall=ns-m2" }],
};

test("Regelwerk muss freigegeben werden (#2269): geänderte Werte oder wartender Entwurf, je mit Weg", () => {
  render(<MemoryRouter><DutyAttention duty={{ rules_pending: DUTY.rules_pending }} /></MemoryRouter>);
  expect(hasDutyAttention({ rules_pending: DUTY.rules_pending })).toBe(true);
  const changed = screen.getByTestId("duty-rules-s1");
  expect(changed).toHaveTextContent("Regelwerk muss freigegeben werden: Probe-Liga Season 1");
  expect(changed).toHaveTextContent("Seit Version 2 haben sich 3 Werte geändert");
  expect(screen.getByTestId("duty-rules-open-s1")).toHaveAttribute("href", "/admin/leagues/rules/league_season/s1");
  expect(screen.getByTestId("duty-rules-s2")).toHaveTextContent("Ein Entwurf wartet auf die Freigabe");
  expect(screen.getByTestId("duty-rules-open-s2")).toHaveAttribute("href", "/admin/leagues/rules/league/l1");
});

test("zeigt alle Arten mit Satz und Weg", () => {
  render(<MemoryRouter><DutyAttention duty={DUTY} /></MemoryRouter>);
  expect(screen.getByTestId("duty-rules-s1")).toHaveTextContent("Regelwerk muss freigegeben werden");
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

// Vorfälle (D.5, #1619): Map in Klärung, Serie feststellen, fehlende Map - je mit Satz und Weg zur Matchseite.
test("Vorfälle: Map in Klärung und Serie feststellen stehen zuerst", () => {
  const incident_reviews = [
    { match_id: "m3", title: "Liga · Staffel A", label: "Spieltag 4", code: "in_review", position: 2, url: "/matches/m3#vorfaelle" },
    { match_id: "m4", title: "Liga · Staffel A", label: "Spieltag 5", code: "unsettled", position: 1, url: "/matches/m4#vorfaelle" },
    { match_id: "m5", title: "Liga · Staffel B", label: "Spieltag 5", code: "missing", position: 3, url: "/matches/m5#vorfaelle" },
  ];
  expect(hasDutyAttention({ incident_reviews })).toBe(true);
  render(<MemoryRouter><DutyAttention duty={{ ...DUTY, incident_reviews }} /></MemoryRouter>);
  expect(screen.getByTestId("duty-attention").firstChild).toBe(screen.getByTestId("duty-incident-m3"));
  expect(screen.getByTestId("duty-incident-m3")).toHaveTextContent("Map in Klärung: Spieltag 4");
  expect(screen.getByTestId("duty-incident-m3")).toHaveTextContent("Map 2 ist in Klärung");
  expect(screen.getByTestId("duty-incident-open-m3")).toHaveTextContent("Entscheiden");
  expect(screen.getByTestId("duty-incident-open-m3")).toHaveAttribute("href", "/matches/m3#vorfaelle");
  expect(screen.getByTestId("duty-incident-m4")).toHaveTextContent("Serie feststellen: Spieltag 5");
  expect(screen.getByTestId("duty-incident-m4")).toHaveTextContent("Jetzt die Serie feststellen");
  expect(screen.getByTestId("duty-incident-m5")).toHaveTextContent("fehlt noch Map 3");
});

test("ohne Fälle nichts", () => {
  expect(hasDutyAttention({ ended_live: [], overdue_matches: [], rules_pending: [], checkin_proposals: [], incident_reviews: [] })).toBe(false);
  expect(hasDutyAttention({ checkin_proposals: [{ match_id: "m2" }] })).toBe(true);
  expect(hasDutyAttention(null)).toBe(false);
  const { container } = render(<MemoryRouter><DutyAttention duty={{}} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
