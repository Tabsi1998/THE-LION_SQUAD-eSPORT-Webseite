import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mail-Warteschlange (#1361): je Zeile nur die Aktion, die zum Stand passt - „Nochmal versuchen“ nur bei
// Fehlgeschlagenem, „Löschen“ unter „Mehr“. Stand, Vorlage und Fehler auf Deutsch, keine Rohwerte.

const { MailQueueSection } = await import("./MailQueueSection");
const { mailErrorSentence, mailTemplateLabel, queueActions, queueDetail } = await import("../shared");

const JOBS = [
  { id: "m-failed", to: "anna@example.test", subject: "Deine Anmeldung", template_key: "registration_received", template_label: "Turnier: Anmeldung eingegangen",
    status: "failed", attempts: 5, last_error: "(550, b'5.1.1 user unknown')", created_at: "2026-10-08T07:00:00+00:00", next_attempt_at: "2026-10-08T07:40:00+00:00" },
  { id: "m-sent", to: "ben@example.test", subject: "Dein Gewinn", template_key: "prize_ready", status: "sent", attempts: 1, sent_at: "2026-10-08T17:00:00+00:00",
    created_at: "2026-10-08T16:59:00+00:00" },
  { id: "m-pending", to: "cleo@example.test", subject: "Willkommen", template_key: "registration", status: "pending", attempts: 0, next_attempt_at: "2026-10-08T18:00:00+00:00",
    created_at: "2026-10-08T17:59:00+00:00" },
  { id: "m-sending", to: "dora@example.test", subject: "Erinnerung", template_key: "match_reminder", status: "sending", attempts: 0, created_at: "2026-10-08T17:58:00+00:00" },
];

function renderSection(overrides = {}) {
  const props = {
    queue: JOBS, filteredQueue: JOBS, queueStats: { due_pending: 1, stale_sending: 0 }, queueFilter: "", setQueueFilter: vi.fn(),
    queueCounts: { pending: 1, sending: 1, sent: 1, failed: 1, skipped: 0 }, processQueueNow: vi.fn(), recoverQueue: vi.fn(), retryFailedQueue: vi.fn(),
    cleanupQueue: vi.fn(), retryJob: vi.fn(), deleteJob: vi.fn(), ...overrides,
  };
  render(<MailQueueSection {...props} />);
  return props;
}

test("je Stand nur die passende Aktion", () => {
  expect(queueActions({ status: "failed" })).toEqual({ retry: true, remove: true });
  expect(queueActions({ status: "sent" })).toEqual({ retry: false, remove: true });
  expect(queueActions({ status: "pending" })).toEqual({ retry: false, remove: true });
  expect(queueActions({ status: "skipped" })).toEqual({ retry: false, remove: true });
  expect(queueActions({ status: "sending" })).toEqual({ retry: false, remove: false });
});

test("Fehler als Satz, Vorlage mit Namen", () => {
  expect(mailErrorSentence("(550, b'5.1.1 user unknown')")).toBe("Postfach unbekannt – die Adresse gibt es beim Empfänger nicht.");
  expect(mailErrorSentence("Resend API key not configured")).toBe("Der Mailversand ist noch nicht eingerichtet – unter Verbindungen nachsehen.");
  expect(mailErrorSentence("SMTP Login ist aktiv, aber Benutzer oder Passwort fehlt.")).toMatch(/^Die Anmeldung beim Mail-Anbieter hat nicht geklappt/);
  expect(mailErrorSentence("Versand deaktiviert")).toBe("Der Mailversand war ausgeschaltet.");
  expect(mailErrorSentence("something odd")).toBe("Der Versand hat nicht geklappt.");
  expect(mailErrorSentence("")).toBe("");
  expect(mailTemplateLabel({ template_key: "unbekannte_vorlage" })).toBe("Mail");
  expect(mailTemplateLabel({ template_key: "x", template_label: "Konto gesperrt" })).toBe("Konto gesperrt");
  const when = () => "8.10. 19:00";
  expect(queueDetail(JOBS[0], when)).toBe("Postfach unbekannt – die Adresse gibt es beim Empfänger nicht. Aufgegeben nach 5 Versuchen.");
  expect(queueDetail(JOBS[1], when)).toBe("Gesendet am 8.10. 19:00.");
  expect(queueDetail({ ...JOBS[2], last_error: "timed out" }, when)).toBe("Nächster Versuch 8.10. 19:00. Zuletzt: Der Mailserver hat nicht rechtzeitig geantwortet.");
});

test("Tabelle und Karten: nur die fehlgeschlagene Mail hat „Nochmal versuchen“, Stand auf Deutsch", async () => {
  const user = userEvent.setup();
  const props = renderSection();
  const table = screen.getByTestId("queue-table");
  expect(within(table).getAllByRole("button", { name: /Nochmal versuchen/ })).toHaveLength(1);
  expect(screen.getByTestId("queue-retry-m-failed")).toBeInTheDocument();
  for (const id of ["m-sent", "m-pending", "m-sending"]) {
    expect(screen.queryByTestId(`queue-retry-${id}`)).toBeNull();
    expect(screen.queryByTestId(`queue-card-retry-${id}`)).toBeNull();
  }
  expect(screen.queryByTestId("queue-more-m-sending")).toBeNull();
  expect(screen.getByTestId("queue-state-m-failed")).toHaveTextContent("Fehlgeschlagen");
  expect(screen.getByTestId("queue-state-m-sent")).toHaveTextContent("Gesendet");
  expect(screen.getByTestId("queue-state-m-pending")).toHaveTextContent("Wartet");
  expect(screen.getByTestId("queue-state-m-sending")).toHaveTextContent("Wird gesendet");
  expect(screen.getByTestId("queue-detail-m-failed")).toHaveTextContent("Postfach unbekannt");
  expect(table).toHaveTextContent("Turnier: Anmeldung eingegangen");
  expect(table).not.toHaveTextContent(/\b(failed|sent|pending|sending|prize_ready)\b/);
  expect(within(screen.getByTestId("queue-filter")).getAllByRole("option").map((option) => option.textContent))
    .toEqual(["Alle", "Wartet", "Wird gesendet", "Gesendet", "Fehlgeschlagen", "Übersprungen"]);
  expect(screen.getByTestId("queue-recover")).toHaveTextContent("Hängende Mails neu anstoßen");
  expect(screen.getByTestId("queue-retry-failed")).toHaveTextContent("Alle fehlgeschlagenen nochmal versuchen");

  await user.click(screen.getByTestId("queue-retry-m-failed"));
  expect(props.retryJob).toHaveBeenCalledWith("m-failed");
  expect(screen.queryByTestId("queue-delete-m-sent")).toBeNull();
  await user.click(screen.getByTestId("queue-more-m-sent"));
  await user.click(screen.getByTestId("queue-delete-m-sent"));
  expect(props.deleteJob).toHaveBeenCalledWith(JOBS[1]);
  expect(screen.getByTestId("queue-card-retry-m-failed")).toBeInTheDocument();
});

test("leere Liste und Filter ohne Treffer sagen es in einem Satz", () => {
  renderSection({ queue: [], filteredQueue: [] });
  expect(screen.getByTestId("queue-empty")).toHaveTextContent("Die Warteschlange ist leer.");
});
