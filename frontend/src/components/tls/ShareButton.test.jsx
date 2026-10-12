import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { shareDateLabel, shareText, shareUrl } from "@/lib/sharePage";

// Teilen (#1154): mit Teilen-Menü des Browsers (Handy) öffnet es sich mit Titel, Satz und Adresse; ohne (PC) kommt der
// Link in die Zwischenablage mit kurzer Bestätigung. Der Satz rechnet wie in der App (mobile/src/lib/share.ts).

const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { ShareButton } = await import("./ShareButton");

const NOW = new Date("2026-10-08T10:00:00Z");

afterEach(() => {
  delete navigator.share;
  vi.clearAllMocks();
});

test("Satz und Adresse wie in der App", () => {
  expect(shareText({ title: "Herbst-LAN 2026", start: "2026-11-14T09:00:00+01:00", end: "2026-11-16T18:00:00+01:00", now: NOW })).toBe("Herbst-LAN 2026 · 14.–16. November · THE LION SQUAD");
  expect(shareDateLabel("2026-10-30T09:00:00+01:00", "2026-11-02T18:00:00+01:00", NOW)).toBe("30. Oktober – 2. November");
  expect(shareDateLabel("2027-05-22T16:00:00+02:00", null, NOW)).toBe("Sa 22. Mai 2027 · 16:00");
  expect(shareUrl("album", "sommerfest", "https://lionsquad.at")).toBe("https://lionsquad.at/galerie/sommerfest");
  expect(shareUrl("fastlap", "monza", "https://lionsquad.at")).toBe("https://lionsquad.at/fastlap/monza");
});

test("mit Teilen-Menü des Browsers: Titel, Satz und Adresse", async () => {
  navigator.share = vi.fn(async () => {});
  render(<ShareButton kind="event" id="herbst-lan" title="Herbst-LAN 2026" />);
  const button = screen.getByTestId("page-share");
  expect(button).toHaveTextContent("Teilen");
  fireEvent.click(button);
  await waitFor(() => expect(navigator.share).toHaveBeenCalledWith({ title: "Herbst-LAN 2026", text: "Herbst-LAN 2026 · THE LION SQUAD", url: `${window.location.origin}/events/herbst-lan` }));
  expect(toastMock.success).not.toHaveBeenCalled();
});

test("ohne Teilen-Menü (PC): „Link kopieren“ legt den Link in die Zwischenablage und bestätigt kurz", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<ShareButton kind="team" id="t-1" title="Lions Rocket [LRK]" detail="Team" />);
  const button = screen.getByTestId("page-share");
  expect(button).toHaveTextContent("Link kopieren");
  fireEvent.click(button);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/teams/t-1`));
  expect(toastMock.success).toHaveBeenCalledWith("Link kopiert.");
  expect(await screen.findByText("Kopiert")).toBeInTheDocument();
});
