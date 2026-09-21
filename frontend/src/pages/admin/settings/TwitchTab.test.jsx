import { render, screen } from "@testing-library/react";
import { TwitchTab, apiCard, pollCard } from "./TwitchTab";

// Twitch-Reiter (#310): „gespeichert“ heißt nicht „läuft“. Der Reiter sagt, woran
// die Abfrage scheitert, und je Kanal, ob er auf die Startseite käme.

const noop = () => {};

function renderTab(status) {
  return render(
    <TwitchTab brand={{ twitch_client_secret_masked: "********" }} setBrandField={noop} status={status}
      saving={false} refreshing={false} onSave={noop} onRefresh={noop} onClearSecret={noop} />
  );
}

test("ein gespeichertes, aber nicht lesbares Secret ist kein OK", () => {
  expect(apiCard({ configured: false })).toEqual({ ok: false, detail: "Client-ID oder Secret fehlt" });
  expect(apiCard({ configured: true, enabled: true, client_secret_readable: false }).ok).toBe(false);
  expect(apiCard({ configured: true, enabled: true, client_secret_readable: false }).problem).toMatch(/neu eintragen/);
  expect(apiCard({ configured: true, enabled: false, client_secret_readable: true }).detail).toBe("Live-Erkennung ist ausgeschaltet");
  expect(apiCard({ configured: true, enabled: true, client_secret_readable: true }).ok).toBe(true);
});

test("die letzte Abfrage nennt den Grund, wenn sie nichts liefert", () => {
  expect(pollCard({}).ok).toBe(false);
  expect(pollCard({}).detail).toMatch(/Noch kein Lauf/);
  const broken = pollCard({ poll: { last_run_at: "2026-09-21T10:00:00+00:00", ok: false, reason_text: "Twitch lehnt Client-ID oder Client-Secret ab", detail: "HTTP 400" } });
  expect(broken.ok).toBe(false);
  expect(broken.problem).toBe("Twitch lehnt Client-ID oder Client-Secret ab (HTTP 400)");
  const fine = pollCard({ poll: { last_run_at: "2026-09-21T10:00:00+00:00", ok: true, live: 1, checked: 4 } });
  expect(fine.ok).toBe(true);
  expect(fine.detail).toMatch(/1 live von 4 Kanälen/);
});

test("je Kanal steht, ob er auf die Startseite käme und warum nicht", () => {
  renderTab({
    configured: true, enabled: true, client_secret_readable: true, checked_users: 2, channels_visible: 1, channels_detailed: true,
    poll: { last_run_at: "2026-09-21T10:00:00+00:00", ok: true, live: 1, checked: 2 },
    channels: [
      { user_id: "u1", username: "mitglied", twitch_login: "mitglied", is_live: true, homepage_visible: true, reason_text: "erscheint auf der Startseite, sobald der Kanal live ist" },
      { user_id: "u2", username: "gast", twitch_login: "gast_tv", is_live: false, homepage_visible: false, reason_text: "keine aktive Mitgliedschaft (nötig: aktiv oder Ehrenmitglied)" },
    ],
  });
  expect(screen.getByTestId("twitch-card-channels")).toHaveTextContent("2 Accounts mit Twitch-Feld, 1 davon kämen auf die Startseite");
  expect(screen.getByTestId("twitch-channel-mitglied")).toHaveTextContent("Startseite");
  expect(screen.getByTestId("twitch-channel-mitglied")).toHaveTextContent("twitch.tv/mitglied · live");
  expect(screen.getByTestId("twitch-channel-gast")).toHaveTextContent("nicht sichtbar");
  expect(screen.getByTestId("twitch-channel-gast")).toHaveTextContent("keine aktive Mitgliedschaft");
  expect(screen.getByTestId("twitch-channels")).not.toHaveTextContent("Den genauen Grund sieht die Vereinsverwaltung.");
});

test("ohne Vereinsverwaltung steht der Hinweis, wer den Grund sieht", () => {
  renderTab({
    configured: true, enabled: true, client_secret_readable: true, channels_detailed: false,
    channels: [{ user_id: "u2", username: "gast", twitch_login: "gast", homepage_visible: false, reason_text: "nicht für die Startseite freigeschaltet – den Grund sieht die Vereinsverwaltung" }],
  });
  expect(screen.getByTestId("twitch-channels")).toHaveTextContent("Den genauen Grund sieht die Vereinsverwaltung.");
});
