import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationRow, notificationBadge } from "./NotificationRow";

// Eine Zeile im Postfach (#255): Titel, Vorschau, Zeit - bei einem Erfolgs-Paket (#622) zusätzlich das Abzeichen des
// wertvollsten Materials. Andere Meldungen bleiben, wie sie sind.

const base = { id: "n1", title: "3 neue Erfolge", body: "darunter Gold: Champion III · +120 Punkte", created_at: "2026-10-08T18:00:00Z", read: false, count: 1, target: "/profile?tab=achievements" };

test("ein Erfolgs-Paket zeigt das Abzeichen des wertvollsten Materials", () => {
  const bundle = { ...base, kind: "achievement", meta: { top: { name: "Champion III", material: "gold", level: 3, rank: 3, art: null, icon: "trophy" } } };
  expect(notificationBadge(bundle)).toEqual(bundle.meta.top);
  render(<MemoryRouter><NotificationRow bundle={bundle} /></MemoryRouter>);
  expect(screen.getByTestId("notification-row-badge-n1")).toBeInTheDocument();
  expect(screen.getByText("3 neue Erfolge")).toBeInTheDocument();
});

test("andere Meldungen und alte Erfolgs-Meldungen ohne Material bleiben ohne Abzeichen", () => {
  expect(notificationBadge({ ...base, kind: "direct_message", meta: { top: { material: "gold" } } })).toBeNull();
  expect(notificationBadge({ ...base, kind: "achievement", meta: { awards: [] } })).toBeNull();
  render(<MemoryRouter><NotificationRow bundle={{ ...base, kind: "direct_message", meta: {} }} /></MemoryRouter>);
  expect(screen.queryByTestId("notification-row-badge-n1")).toBeNull();
});
