import { render, screen } from "@testing-library/react";

// Vereinsgeburtstag (#644) auf „Über uns“ und im Mitgliederbereich: nur solange die Saison läuft - „Heute vor X Jahren
// gegründet“ bzw. der Hinweis mit dem Jahres-Sticker; ohne Jahre (kein Gründungsdatum, Vorschau) ohne Zahl.

const contextState = { seasons: [] };
vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => contextState }));
vi.mock("@/seasons/birthday/StickerClaim", () => ({ StickerClaim: ({ testId }) => <span data-testid={testId}>Sticker</span> }));

const { BirthdayLine } = await import("./AboutPage");
const { BirthdayNote } = await import("../user/MemberAreaPage");

const birthday = (years) => ({ key: "club_birthday", data: years ? { years } : {}, effective: "normal" });

test("Über uns: die Zeile nur am Geburtstag, mit den Jahren", () => {
  contextState.seasons = [];
  const { container, rerender } = render(<BirthdayLine />);
  expect(container.innerHTML).toBe("");
  contextState.seasons = [birthday(8)];
  rerender(<BirthdayLine />);
  expect(screen.getByTestId("about-birthday")).toHaveTextContent("Heute vor 8 Jahren gegründet – danke, dass ihr dabei seid!");
  contextState.seasons = [birthday(1)];
  rerender(<BirthdayLine />);
  expect(screen.getByTestId("about-birthday")).toHaveTextContent("Heute vor 1 Jahr gegründet");
  contextState.seasons = [birthday(null)];
  rerender(<BirthdayLine />);
  expect(screen.getByTestId("about-birthday")).toHaveTextContent("Heute hat der Verein Geburtstag");
});

test("Mitgliederbereich: der Hinweis mit dem Jahres-Sticker nur am Geburtstag", () => {
  contextState.seasons = [];
  const { container, rerender } = render(<BirthdayNote />);
  expect(container.innerHTML).toBe("");
  contextState.seasons = [birthday(8)];
  rerender(<BirthdayNote />);
  expect(screen.getByTestId("member-area-birthday")).toHaveTextContent("Heute vor 8 Jahren wurde der Verein gegründet.");
  expect(screen.getByTestId("member-area-birthday-sticker")).toBeTruthy();
});
