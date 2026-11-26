import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createCeremonyQueue } from "@/components/achievements/ceremony/queue";
import { LeagueMomentHint } from "./LeagueMomentHint";

// Saisonende-Moment (#1639): der bleibende Hinweis an Profil und Teamseite.
const moment = (outcome = "up", extra = {}) => {
  const levels = { up: [2, 1], down: [2, 3], champion: [1, 1] }[outcome];
  return {
    id: `m-${outcome}`, outcome, title: "Probe-Liga · Season 1", url: "/liga/probe/season-1", display_name: "Nordlicht Eins",
    from: { level: levels[0], label: `Liga ${levels[0]}` }, to: { level: levels[1], label: `Liga ${levels[1]}` },
    badge_from: { level: levels[0], nickname: null, champion: false }, badge_to: { level: levels[1], nickname: null, champion: outcome === "champion" },
    texts: {
      up: { label: "Aufstieg", kicker: "Aufstieg", title: "Liga 1", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1",
        line: "Nordlicht Eins steigt von Liga 2 in Liga 1 auf.", summary: "Nordlicht Eins steigt von Liga 2 in Liga 1 auf.", next: null, aria: "Aufstieg: Nordlicht Eins steigt von Liga 2 in Liga 1 auf." },
      down: { label: "Abstieg", kicker: "Abstieg", title: "Nächste Season in Liga 3", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1",
        line: "Nordlicht Eins wechselt von Liga 2 in Liga 3.", summary: "Nordlicht Eins spielt die nächste Season in Liga 3.", next: "Die neue Season beginnt für alle bei null.", aria: "Abstieg: …" },
      champion: { label: "Meister", kicker: "Liga 1", title: "Meister", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1", summary: "Nordlicht Eins ist Meister in Liga 1.",
        line: "Platz 1 im Endstand der Season.", next: null, aria: "Meister: Nordlicht Eins ist Meister." },
    }[outcome],
    next_step: null,
    ...extra,
  };
};

test("der Hinweis nennt den Ausgang und spielt den Moment nur für die Person selbst noch einmal ab", () => {
  const queue = createCeremonyQueue();
  const { rerender } = render(<MemoryRouter><LeagueMomentHint rows={[moment("up"), moment("champion", { corrected: true })]} queue={queue} /></MemoryRouter>);
  expect(screen.getByTestId("league-moments-m-up")).toHaveTextContent("Nordlicht Eins steigt von Liga 2 in Liga 1 auf.");
  expect(screen.getByTestId("league-moments-m-champion")).toHaveTextContent("Endstand korrigiert");
  expect(screen.queryByTestId("league-moments-m-up-replay")).toBeNull();
  rerender(<MemoryRouter><LeagueMomentHint rows={[moment("up")]} canReplay queue={queue} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("league-moments-m-up-replay"));
  expect(queue.getCurrent().moments[0].id).toBe("m-up");
  expect(queue.getCurrent().check).toBeNull();
});

test("ohne Einträge kein Hinweis", () => {
  const { container } = render(<MemoryRouter><LeagueMomentHint rows={[]} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
