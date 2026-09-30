import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DoorSheet, KIND_LABELS, PRIZES_URL, PrizeBlock, QuizBlock } from "./DoorSheet";
import type { Door, DoorContent, PrizeState } from "./doors";

// Der Inhalt eines Türchens in der App (#641, #642): derselbe Inhalt wie im Web. Videos und Clips bettet die App
// nicht ein; das Quiz löst nach der Antwort auf; bei der Verlosung ist Mitmachen ein eigener Knopf.

jest.mock("../lib/api", () => ({
  resolveMediaUrl: (value?: string | null) => (value ? `https://lionsquad.at${value}` : ""),
  errorMessage: (error: unknown, fallback: string) => (error as { detail?: string })?.detail || fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockOverlay = jest.fn();
jest.mock("../seasons/anchors", () => ({ useSeasonOverlay: (id: string, open: boolean) => mockOverlay(id, open) }));

const PRIZE: PrizeState = {
  label: "TLS-Hoodie", value: "Größe nach Wahl", winners: 2, audience: "all", closes_at: "2026-12-20T20:00:00+01:00", status: "open",
  entries: 3, entered: false, can_enter: true, can_withdraw: false, won: false, hint: null,
  terms: ["Mitmachen kann, wer ein Konto hat.", "Gezogen wird nach dem Teilnahmeschluss."],
};

function door(content: Partial<DoorContent>, day = 12): Door {
  return { day, seed: 99, opens_at: "2026-12-12T06:00:00+01:00", state: "opened", content: { kind: "text", title: "Ein Gruß", ...content } };
}

function handlers() {
  return { onClose: jest.fn(), onAnswer: jest.fn(), onRaffle: jest.fn(), onLink: jest.fn(), onLogin: jest.fn() };
}

async function show(content: Partial<DoorContent>, { signedIn = true, day = 12 }: { signedIn?: boolean; day?: number } = {}) {
  const props = handlers();
  const view = await render(<DoorSheet door={door(content, day)} signedIn={signedIn} {...props} />);
  return { ...props, ...view };
}

afterEach(() => {
  jest.clearAllMocks();
});

test("ohne Türchen kein Fenster; mit Türchen Titel, Art und Text", async () => {
  const view = await render(<DoorSheet door={null} signedIn {...handlers()} />);
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
  expect(mockOverlay).toHaveBeenLastCalledWith("advent-door", false);
  await view.rerender(<DoorSheet door={{ day: 3, seed: 1, opens_at: "", state: "opened" }} signedIn {...handlers()} />);
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
  await view.rerender(<DoorSheet door={door({ body: "Schön, dass du da bist." })} signedIn {...handlers()} />);
  expect(screen.getByTestId("advent-sheet-title").props.children).toBe("Ein Gruß");
  expect(screen.getByText("TÜRCHEN 12 · GRUSS")).toBeTruthy();
  expect(screen.getByTestId("advent-text").props.children).toBe("Schön, dass du da bist.");
  // Solange das Fenster offen ist, ruht die Deko der Saison darunter.
  expect(mockOverlay).toHaveBeenLastCalledWith("advent-door", true);
});

test("jede Art hat ihren Namen", async () => {
  expect(Object.keys(KIND_LABELS).sort()).toEqual(["clip", "event", "image", "member_spotlight", "news", "prize", "quiz", "sticker", "text", "video"]);
  for (const [kind, label] of [["image", "BILD"], ["member_spotlight", "MITGLIED DER WOCHE"], ["prize", "GEWINN"], ["neu-erfunden", "GRUSS"]]) {
    const view = await show({ kind });
    expect(screen.getByText(`TÜRCHEN 12 · ${label}`)).toBeTruthy();
    await view.unmount();
  }
});

test("Schließen ruft zurück", async () => {
  const { onClose } = await show({});
  await fireEvent.press(screen.getByLabelText("Schließen"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Bild und Sticker aus dem eigenen Upload; ein Bild als Beigabe bei anderen Arten", async () => {
  const image = await show({ kind: "image", title: "Weihnachtsfeier", media_url: "/api/static/uploads/feier.webp" });
  expect(screen.getByTestId("advent-image").props.source).toEqual({ uri: "https://lionsquad.at/api/static/uploads/feier.webp" });
  expect(screen.getByLabelText("Weihnachtsfeier")).toBeTruthy();
  await image.unmount();

  const sticker = await show({ kind: "sticker", title: "Für dich", sticker: { id: "s1", name: "Löwe mit Mütze", url: "/api/static/uploads/loewe.png" }, media_url: "/api/static/uploads/nicht-zeigen.webp" });
  expect(screen.getByTestId("advent-sticker").props.source).toEqual({ uri: "https://lionsquad.at/api/static/uploads/loewe.png" });
  expect(screen.getByLabelText("Löwe mit Mütze")).toBeTruthy();
  expect(screen.queryByTestId("advent-image")).toBeNull();
  await sticker.unmount();

  await show({ kind: "text", body: "Mit Bild.", media_url: "/api/static/uploads/beigabe.webp" });
  expect(screen.getByTestId("advent-image").props.source).toEqual({ uri: "https://lionsquad.at/api/static/uploads/beigabe.webp" });
  expect(screen.getByTestId("advent-image").props.accessibilityLabel).toBeUndefined();
});

test("Video und Clip: ein Knopf führt zu YouTube oder Twitch - eingebettet wird nichts", async () => {
  const video = await show({ kind: "video", title: "Rückblick", video: { id: "abc123", url: "https://www.youtube.com/watch?v=abc123" } });
  await fireEvent.press(screen.getByTestId("advent-video"));
  expect(video.onLink).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc123");
  expect(screen.getByText("Video auf YouTube ansehen")).toBeTruthy();
  expect(screen.queryByTestId("advent-clip")).toBeNull();
  await video.unmount();

  const clip = await show({ kind: "clip", title: "Clip der Woche", clip: { id: "KlugerLoewe", url: "https://clips.twitch.tv/KlugerLoewe" } });
  await fireEvent.press(screen.getByTestId("advent-clip"));
  expect(clip.onLink).toHaveBeenCalledWith("https://clips.twitch.tv/KlugerLoewe");
  await clip.unmount();

  // Ohne Adresse kein Knopf.
  await show({ kind: "video", title: "Rückblick", video: { id: "abc123" } });
  expect(screen.queryByTestId("advent-video")).toBeNull();
});

test("Karten: News, Event und Mitglied der Woche führen auf ihre Seite", async () => {
  const news = await show({ kind: "news", title: "Lesetipp", card: { title: "Advent im Verein", excerpt: "Was im Dezember los ist.", url: "/news/advent-im-verein", image_url: "/api/static/uploads/news.webp" } });
  expect(screen.getByText("NEWS-BEITRAG")).toBeTruthy();
  expect(screen.getByText("Advent im Verein")).toBeTruthy();
  expect(screen.getByText("Was im Dezember los ist.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-card"));
  expect(news.onLink).toHaveBeenCalledWith("/news/advent-im-verein");
  await news.unmount();

  const event = await show({ kind: "event", title: "Komm vorbei", card: { title: "Weihnachts-LAN", date: "2026-12-19T18:00:00+01:00", location: "Vereinsheim", url: "/events/weihnachts-lan" } });
  expect(screen.getByText("19. Dezember 2026 · Vereinsheim")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-card"));
  expect(event.onLink).toHaveBeenCalledWith("/events/weihnachts-lan");
  await event.unmount();

  const member = await show({ kind: "member_spotlight", title: "Danke", card: { name: "Mitglied A", role: "Kassier", url: null } });
  expect(screen.getByText("MITGLIED DER WOCHE")).toBeTruthy();
  expect(screen.getByText("Mitglied A")).toBeTruthy();
  expect(screen.getByText("Kassier")).toBeTruthy();
  // Ohne Adresse führt die Karte nirgends hin.
  await fireEvent.press(screen.getByTestId("advent-card"));
  expect(member.onLink).not.toHaveBeenCalled();
});

test("Link: der Knopf gibt die Adresse weiter", async () => {
  const own = await show({ link: { url: "/events", label: "Zu den Events" } });
  await fireEvent.press(screen.getByTestId("advent-link"));
  expect(own.onLink).toHaveBeenCalledWith("/events");
  expect(screen.getByText("Zu den Events")).toBeTruthy();
  await own.unmount();

  const foreign = await show({ link: { url: "https://example.org/gluehwein" } });
  expect(screen.getByText("Mehr dazu")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-link"));
  expect(foreign.onLink).toHaveBeenCalledWith("https://example.org/gluehwein");
});

const QUIZ = { question: "Wie viele Kerzen hat der Adventkranz?", answers: ["Drei", "Vier", "Fünf"], done: false };

test("Quiz: die Auflösung kommt nach der Antwort - danach ist Schluss", async () => {
  const onAnswer = jest.fn(async () => ({ day: 2, correct: false, correct_index: 1, correct_answer: "Vier", explanation: "Für jeden Adventsonntag eine.", done: true }));
  await render(<QuizBlock day={2} quiz={QUIZ} onAnswer={onAnswer} />);
  expect(screen.getByText("Wie viele Kerzen hat der Adventkranz?")).toBeTruthy();
  expect(screen.queryByTestId("advent-quiz-result")).toBeNull();
  await fireEvent.press(screen.getByTestId("advent-quiz-answer-0"));
  await waitFor(() => expect(screen.getByTestId("advent-quiz-result")).toBeTruthy());
  expect(onAnswer).toHaveBeenCalledWith(2, 0);
  expect(screen.getByText(/Leider nein – richtig ist „Vier“\./)).toBeTruthy();
  expect(screen.getByText(/Für jeden Adventsonntag eine\./)).toBeTruthy();
  for (const index of [0, 1, 2]) expect(screen.getByTestId(`advent-quiz-answer-${index}`).props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByTestId("advent-quiz-answer-1"));
  expect(onAnswer).toHaveBeenCalledTimes(1);
});

test("Quiz: richtig geraten, schon mitgemacht, Antwort kommt nicht an", async () => {
  const right = jest.fn(async () => ({ day: 2, correct: true, correct_index: 1, correct_answer: "Vier", explanation: "", done: true }));
  const first = await render(<QuizBlock day={2} quiz={{ ...QUIZ, done: true }} onAnswer={right} />);
  expect(screen.getByTestId("advent-quiz-done")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-quiz-answer-1"));
  await waitFor(() => expect(screen.getByText("Richtig!")).toBeTruthy());
  expect(screen.queryByTestId("advent-quiz-done")).toBeNull();
  await first.unmount();

  const failing = jest.fn().mockRejectedValueOnce({ detail: "" }).mockRejectedValueOnce({ detail: "Das Quiz ist geschlossen." });
  await render(<QuizBlock day={2} quiz={QUIZ} onAnswer={failing} />);
  await fireEvent.press(screen.getByTestId("advent-quiz-answer-2"));
  await waitFor(() => expect(screen.getByText("Die Antwort ist nicht angekommen. Versuch es noch einmal.")).toBeTruthy());
  // Nach einem Fehler darf die Person noch einmal antworten.
  await fireEvent.press(screen.getByTestId("advent-quiz-answer-2"));
  await waitFor(() => expect(screen.getByText("Das Quiz ist geschlossen.")).toBeTruthy());
  expect(failing).toHaveBeenCalledTimes(2);
});

test("Gewinn: Mitmachen ist ein eigener Knopf, Zurückziehen auch", async () => {
  const onRaffle = jest.fn(async () => PRIZE);
  const view = await render(<PrizeBlock day={7} prize={PRIZE} signedIn onRaffle={onRaffle} onLink={jest.fn()} />);
  expect(screen.getByText("TLS-Hoodie")).toBeTruthy();
  expect(screen.getByText("Größe nach Wahl")).toBeTruthy();
  expect(screen.getByText("2 Gewinne")).toBeTruthy();
  expect(screen.getByTestId("advent-prize-entries").props.children).toBe("3 Personen machen mit");
  expect(screen.getByText("Teilnahme bis 20. Dezember, 20 Uhr")).toBeTruthy();
  expect(screen.queryByTestId("advent-prize-withdraw")).toBeNull();
  expect(screen.queryByTestId("advent-prize-login")).toBeNull();
  await fireEvent.press(screen.getByTestId("advent-prize-enter"));
  await waitFor(() => expect(onRaffle).toHaveBeenCalledWith(7, true));

  await view.rerender(<PrizeBlock day={7} prize={{ ...PRIZE, entries: 1, entered: true, can_enter: false, can_withdraw: true, hint: "Du bist dabei. Viel Glück!" }} signedIn onRaffle={onRaffle} onLink={jest.fn()} />);
  expect(screen.getByTestId("advent-prize-entries").props.children).toBe("1 Person macht mit");
  expect(screen.getByText("Du bist dabei. Viel Glück!")).toBeTruthy();
  expect(screen.queryByTestId("advent-prize-enter")).toBeNull();
  await fireEvent.press(screen.getByTestId("advent-prize-withdraw"));
  await waitFor(() => expect(onRaffle).toHaveBeenLastCalledWith(7, false));
});

test("Gewinn: Gast, nur für Mitglieder, gezogen, gewonnen, Fehler", async () => {
  const onLogin = jest.fn();
  const guest = await render(<PrizeBlock day={7} prize={{ ...PRIZE, winners: 1, can_enter: false, audience: "members", hint: "Melde dich an, um mitzumachen." }} signedIn={false} onRaffle={jest.fn()} onLogin={onLogin} onLink={jest.fn()} />);
  expect(screen.getByText("1 Gewinn")).toBeTruthy();
  expect(screen.getByText("Nur für Vereinsmitglieder")).toBeTruthy();
  expect(screen.queryByTestId("advent-prize-enter")).toBeNull();
  await fireEvent.press(screen.getByTestId("advent-prize-login"));
  expect(onLogin).toHaveBeenCalledTimes(1);
  await guest.unmount();

  const onLink = jest.fn();
  const drawn = await render(<PrizeBlock day={7} prize={{ ...PRIZE, status: "drawn", can_enter: false, won: true, entered: true, hint: "Du hast gewonnen! Den Abholschein findest du unter „Meine Gewinne“." }} signedIn onRaffle={jest.fn()} onLink={onLink} />);
  // Nach der Ziehung steht kein Teilnahmeschluss mehr da.
  expect(screen.queryByText(/Teilnahme bis/)).toBeNull();
  await fireEvent.press(screen.getByTestId("advent-prize-mine"));
  expect(onLink).toHaveBeenCalledWith(PRIZES_URL);
  expect(PRIZES_URL).toBe("/me/prizes");
  await drawn.unmount();

  const failing = jest.fn().mockRejectedValueOnce({ detail: "Die Teilnahme ist geschlossen." }).mockRejectedValueOnce({ detail: "" });
  await render(<PrizeBlock day={7} prize={PRIZE} signedIn onRaffle={failing} onLink={jest.fn()} />);
  await fireEvent.press(screen.getByTestId("advent-prize-enter"));
  await waitFor(() => expect(screen.getByTestId("advent-prize-problem")).toBeTruthy());
  expect(screen.getByText("Die Teilnahme ist geschlossen.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-prize-enter"));
  await waitFor(() => expect(screen.getByText("Das Mitmachen hat nicht geklappt. Versuch es noch einmal.")).toBeTruthy());
});

test("Gewinn: die Teilnahmebedingungen klappen auf", async () => {
  await render(<PrizeBlock day={7} prize={PRIZE} signedIn onRaffle={jest.fn()} onLink={jest.fn()} />);
  expect(screen.getByText("Teilnahmebedingungen")).toBeTruthy();
  expect(screen.queryByText(/Mitmachen kann, wer ein Konto hat\./)).toBeNull();
  await fireEvent.press(screen.getByTestId("advent-prize-terms-toggle"));
  expect(screen.getByText(/1\. Mitmachen kann, wer ein Konto hat\./)).toBeTruthy();
  expect(screen.getByText(/2\. Gezogen wird nach dem Teilnahmeschluss\./)).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-prize-terms-toggle"));
  expect(screen.queryByText(/Gezogen wird/)).toBeNull();
});

test("im Fenster: Quiz und Gewinn bekommen Tag und Rückrufe", async () => {
  const quiz = await show({ kind: "quiz", title: "Kranz-Quiz", quiz: QUIZ }, { day: 2 });
  quiz.onAnswer.mockResolvedValueOnce({ day: 2, correct: true, correct_index: 1, correct_answer: "Vier", explanation: "", done: true });
  await fireEvent.press(screen.getByTestId("advent-quiz-answer-1"));
  await waitFor(() => expect(quiz.onAnswer).toHaveBeenCalledWith(2, 1));
  await waitFor(() => expect(screen.getByText("Richtig!")).toBeTruthy());
  await quiz.unmount();

  const prize = await show({ kind: "prize", title: "Gewinn des Tages", prize: PRIZE }, { day: 7, signedIn: false });
  expect(screen.getByTestId("advent-prize")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-prize-login"));
  expect(prize.onLogin).toHaveBeenCalledTimes(1);
});
