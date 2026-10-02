import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Inhalt eines Türchens (#641): jede Art zeigt, was sie hat; Videos und Clips erst nach Zustimmung; das Quiz
// löst nach der Antwort auf; bei der Verlosung ist Mitmachen ein eigener Klick.

const consent = { value: true };
vi.mock("@/lib/api", () => ({ api: {}, resolveMediaUrl: (value) => (value ? `https://medien.test${value}` : "") }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => consent.value, openSettings: () => {} }) }));
vi.mock("@/components/tls/ExternalMediaNotice", () => ({ ExternalMediaNotice: ({ service, url, testId }) => <div data-testid={testId}>{service} {url}</div> }));

const { DoorDialog, KIND_LABELS } = await import("./DoorDialog");

const PRIZE = {
  label: "TLS-Hoodie", value: "Größe nach Wahl", winners: 2, audience: "all", closes_at: "2026-12-13T20:00:00+01:00", status: "open",
  entries: 37, entered: false, can_enter: true, can_withdraw: false, won: false, hint: null,
  terms: ["Mitmachen kann, wer ein Konto hat.", "Gezogen wird per Zufall."],
};

function show(content, props = {}) {
  const handlers = { onClose: vi.fn(), onAnswer: vi.fn(), onRaffle: vi.fn() };
  const door = content ? { day: 12, seed: 5, state: "opened", content: { title: "Titel", body: "", media_url: null, link: null, ...content } } : null;
  const view = render(<MemoryRouter><DoorDialog door={door} signedIn={props.signedIn ?? true} light={{ soft: "rgba(255, 180, 84, 0.55)" }} {...handlers} {...props.handlers} /></MemoryRouter>);
  return { ...handlers, ...(props.handlers || {}), ...view, door };
}

beforeEach(() => {
  consent.value = true;
});

test("ohne Türchen kein Fenster; mit Türchen Titel, Art und Text", () => {
  const { unmount } = show(null);
  expect(screen.queryByTestId("advent-dialog")).toBeNull();
  unmount();
  show({ kind: "text", title: "Willkommen im Advent", body: "Zeile eins\nZeile zwei" });
  const dialog = screen.getByRole("dialog", { name: "Willkommen im Advent" });
  expect(dialog).toHaveTextContent("Türchen 12 · Gruß");
  expect(screen.getByTestId("advent-text")).toHaveTextContent("Zeile eins Zeile zwei");
  expect(screen.getByTestId("advent-dialog-close")).toHaveTextContent("Schließen");
  expect(dialog.style.getPropertyValue("--dialog-light")).toBe("rgba(255, 180, 84, 0.55)");
});

test("jede Art hat ihren Namen", () => {
  expect(Object.keys(KIND_LABELS)).toEqual(["text", "image", "video", "clip", "news", "event", "member_spotlight", "sticker", "quiz", "prize"]);
});

test("Schließen ruft zurück", () => {
  const { onClose } = show({ kind: "text", body: "x" });
  fireEvent.click(screen.getByTestId("advent-dialog-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Bild und Sticker aus dem eigenen Upload; ein Bild als Beigabe bei anderen Arten", () => {
  const first = show({ kind: "image", title: "Foto", media_url: "/api/static/uploads/a.webp" });
  expect(screen.getByTestId("advent-image")).toHaveAttribute("src", "https://medien.test/api/static/uploads/a.webp");
  expect(screen.getByTestId("advent-image")).toHaveAttribute("alt", "Foto");
  first.unmount();
  const second = show({ kind: "sticker", sticker: { id: "s1", name: "Löwe jubelt", url: "/api/stickers/files/pack/loewe.png", width: 256, height: 256 } });
  expect(screen.getByTestId("advent-sticker")).toHaveAttribute("alt", "Löwe jubelt");
  second.unmount();
  show({ kind: "text", body: "Mit Bild", media_url: "/api/static/uploads/b.webp" });
  expect(screen.getByTestId("advent-illustration")).toHaveAttribute("alt", "");
});

test("Video und Clip laden erst nach der Zustimmung zu externen Medien", () => {
  consent.value = false;
  const first = show({ kind: "video", video: { id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  expect(screen.getByTestId("video-consent-notice")).toBeInTheDocument();
  expect(document.querySelector("iframe")).toBeNull();
  first.unmount();
  const second = show({ kind: "clip", clip: { id: "GoodOne-xyz", url: "https://clips.twitch.tv/GoodOne-xyz" } });
  expect(screen.getByTestId("advent-clip-consent")).toHaveTextContent("Twitch Clip https://clips.twitch.tv/GoodOne-xyz");
  expect(document.querySelector("iframe")).toBeNull();
  second.unmount();

  consent.value = true;
  const third = show({ kind: "video", video: { id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  expect(screen.getByTestId("video-embed-frame")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  third.unmount();
  show({ kind: "clip", title: "Bester Moment", clip: { id: "GoodOne-xyz", url: "https://clips.twitch.tv/GoodOne-xyz" } });
  const frame = screen.getByTestId("advent-clip-frame");
  expect(frame).toHaveAttribute("title", "Bester Moment");
  expect(frame.getAttribute("src")).toContain("clip=GoodOne-xyz");
  // Im Türchen spielt nichts von selbst los.
  expect(frame.getAttribute("src")).toContain("autoplay=false");
});

test("Karten: News, Event und Mitglied der Woche führen auf ihre Seite", () => {
  const first = show({ kind: "news", card: { title: "Wintercup", excerpt: "Bald geht es los", image_url: "/api/static/uploads/n.webp", url: "/news/wintercup", date: "2026-12-04T10:00:00+01:00" } });
  let card = screen.getByTestId("advent-card");
  expect(card).toHaveAttribute("href", "/news/wintercup");
  expect(card).toHaveTextContent("News-BeitragWintercupBald geht es los");
  expect(card.querySelector("img")).toHaveAttribute("src", "https://medien.test/api/static/uploads/n.webp");
  first.unmount();
  const second = show({ kind: "event", card: { title: "Weihnachtsfeier", image_url: null, url: "/events/weihnachtsfeier", date: "2026-12-19T18:00:00+01:00", location: "Vereinsheim" } });
  card = screen.getByTestId("advent-card");
  expect(card).toHaveTextContent("EventWeihnachtsfeier19. Dezember 2026 · Vereinsheim");
  expect(card.className).toContain("tls-adv-card--plain");
  second.unmount();
  const third = show({ kind: "member_spotlight", card: { name: "Pauli", role: "Kapitänin", image_url: null, url: "/members/paula" } });
  expect(screen.getByTestId("advent-card")).toHaveTextContent("Mitglied der WochePauliKapitänin");
  expect(screen.getByTestId("advent-card")).toHaveAttribute("href", "/members/paula");
  third.unmount();
  show({ kind: "member_spotlight", card: { name: "Pauli", role: "Mitglied", image_url: null, url: null } });
  expect(screen.getByTestId("advent-card").tagName).toBe("DIV");
});

test("Link: eigene Seite im selben Fenster, fremde Seite im neuen", () => {
  const first = show({ kind: "text", body: "x", link: { url: "/news", label: "Zu den News" } });
  expect(screen.getByTestId("advent-link")).toHaveAttribute("href", "/news");
  expect(screen.getByTestId("advent-link")).not.toHaveAttribute("target");
  first.unmount();
  show({ kind: "text", body: "x", link: { url: "https://example.com/seite" } });
  const link = screen.getByTestId("advent-link");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(link).toHaveTextContent("Mehr dazu");
});

test("Quiz: die Auflösung kommt nach der Antwort - danach ist Schluss", async () => {
  const onAnswer = vi.fn().mockResolvedValue({ day: 12, correct: false, correct_index: 1, correct_answer: "Vier", explanation: "Eine je Adventsonntag.", done: true });
  show({ kind: "quiz", quiz: { question: "Wie viele Kerzen hat der Adventkranz?", answers: ["Drei", "Vier", "Fünf"], done: false } }, { handlers: { onAnswer } });
  const quiz = screen.getByTestId("advent-quiz");
  expect(quiz).toHaveTextContent("Wie viele Kerzen hat der Adventkranz?");
  expect(within(quiz).getAllByRole("button").map((button) => button.textContent)).toEqual(["ADrei", "BVier", "CFünf"]);
  expect(screen.queryByTestId("advent-quiz-result")).toBeNull();

  fireEvent.click(screen.getByTestId("advent-quiz-answer-0"));
  expect(onAnswer).toHaveBeenCalledWith(12, 0);
  const result = await screen.findByTestId("advent-quiz-result");
  expect(result).toHaveTextContent("Leider nein – richtig ist „Vier“. Eine je Adventsonntag.");
  expect(screen.getByTestId("advent-quiz-answer-0")).toHaveAttribute("data-result", "wrong");
  expect(screen.getByTestId("advent-quiz-answer-1")).toHaveAttribute("data-result", "right");
  expect(screen.getByTestId("advent-quiz-answer-2")).toHaveAttribute("data-result", "other");
  for (const index of [0, 1, 2]) expect(screen.getByTestId(`advent-quiz-answer-${index}`)).toBeDisabled();
  fireEvent.click(screen.getByTestId("advent-quiz-answer-1"));
  expect(onAnswer).toHaveBeenCalledTimes(1);
});

test("Quiz: richtig geraten, schon mitgemacht, Antwort kommt nicht an", async () => {
  const right = vi.fn().mockResolvedValue({ correct: true, correct_index: 1, correct_answer: "Vier", explanation: "" });
  const first = show({ kind: "quiz", quiz: { question: "?", answers: ["a", "b", "c"], done: true } }, { handlers: { onAnswer: right } });
  expect(screen.getByTestId("advent-quiz-done")).toHaveTextContent("schon mitgemacht");
  fireEvent.click(screen.getByTestId("advent-quiz-answer-1"));
  expect(await screen.findByTestId("advent-quiz-result")).toHaveTextContent("Richtig!");
  expect(screen.queryByTestId("advent-quiz-done")).toBeNull();
  first.unmount();

  const failing = vi.fn().mockRejectedValue({ response: { data: { detail: "Öffne zuerst das Türchen." } } });
  show({ kind: "quiz", quiz: { question: "?", answers: ["a", "b", "c"], done: false } }, { handlers: { onAnswer: failing } });
  fireEvent.click(screen.getByTestId("advent-quiz-answer-2"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Öffne zuerst das Türchen.");
  expect(screen.getByTestId("advent-quiz-answer-2")).not.toBeDisabled();
  expect(screen.queryByTestId("advent-quiz-result")).toBeNull();
});

test("Gewinn: Mitmachen ist ein eigener Klick, Zurückziehen auch", async () => {
  const onRaffle = vi.fn().mockResolvedValue({});
  const first = show({ kind: "prize", body: "Mach mit!", prize: PRIZE }, { handlers: { onRaffle } });
  const prize = screen.getByTestId("advent-prize");
  expect(prize).toHaveAttribute("data-status", "open");
  expect(prize).toHaveTextContent("TLS-HoodieGröße nach Wahl");
  expect(prize).toHaveTextContent("2 Gewinne");
  expect(screen.getByTestId("advent-prize-entries")).toHaveTextContent("37 Personen machen mit");
  expect(prize).toHaveTextContent("Teilnahme bis 13. Dezember, 20 Uhr");
  expect(screen.queryByTestId("advent-prize-hint")).toBeNull();
  expect(screen.queryByTestId("advent-prize-withdraw")).toBeNull();
  expect(onRaffle).not.toHaveBeenCalled();
  expect(within(screen.getByTestId("advent-prize-terms")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(PRIZE.terms);

  fireEvent.click(screen.getByTestId("advent-prize-enter"));
  await waitFor(() => expect(onRaffle).toHaveBeenCalledWith(12, true));
  first.unmount();

  show({ kind: "prize", prize: { ...PRIZE, entries: 1, winners: 1, entered: true, can_enter: false, can_withdraw: true, hint: "Du bist dabei. Viel Glück!" } }, { handlers: { onRaffle } });
  expect(screen.getByTestId("advent-prize-hint")).toHaveTextContent("Du bist dabei. Viel Glück!");
  expect(screen.getByTestId("advent-prize-entries")).toHaveTextContent("1 Person macht mit");
  expect(screen.getByTestId("advent-prize")).toHaveTextContent("1 Gewinn");
  expect(screen.queryByTestId("advent-prize-enter")).toBeNull();
  fireEvent.click(screen.getByTestId("advent-prize-withdraw"));
  await waitFor(() => expect(onRaffle).toHaveBeenLastCalledWith(12, false));
});

test("Gewinn: Gast, nur für Mitglieder, gezogen, gewonnen, Fehler", async () => {
  const guest = show({ kind: "prize", prize: { ...PRIZE, can_enter: false, hint: "Melde dich an, um mitzumachen." } }, { signedIn: false });
  expect(screen.getByTestId("advent-prize-login")).toHaveAttribute("href", "/login");
  expect(screen.getByTestId("advent-prize-hint")).toHaveTextContent("Melde dich an, um mitzumachen.");
  expect(screen.queryByTestId("advent-prize-enter")).toBeNull();
  guest.unmount();

  const members = show({ kind: "prize", prize: { ...PRIZE, audience: "members", can_enter: false, hint: "Diese Verlosung ist für Vereinsmitglieder." } });
  expect(screen.getByTestId("advent-prize")).toHaveTextContent("Nur für Vereinsmitglieder");
  expect(screen.queryByTestId("advent-prize-login")).toBeNull();
  members.unmount();

  const drawn = show({ kind: "prize", prize: { ...PRIZE, status: "drawn", can_enter: false, hint: "Die Verlosung ist gezogen. Wer gewonnen hat, wurde benachrichtigt." } });
  expect(screen.getByTestId("advent-prize")).not.toHaveTextContent("Teilnahme bis");
  expect(screen.queryByTestId("advent-prize-mine")).toBeNull();
  drawn.unmount();

  const won = show({ kind: "prize", prize: { ...PRIZE, status: "drawn", can_enter: false, won: true, hint: "Du hast gewonnen – schau unter „Meine Gewinne“." } });
  expect(screen.getByTestId("advent-prize-mine")).toHaveAttribute("href", "/me/prizes");
  won.unmount();

  const onRaffle = vi.fn().mockRejectedValue({ response: { data: { detail: "Die Teilnahme an dieser Verlosung ist vorbei." } } });
  show({ kind: "prize", prize: PRIZE }, { handlers: { onRaffle } });
  fireEvent.click(screen.getByTestId("advent-prize-enter"));
  expect(await screen.findByTestId("advent-prize-problem")).toHaveTextContent("Die Teilnahme an dieser Verlosung ist vorbei.");
});
