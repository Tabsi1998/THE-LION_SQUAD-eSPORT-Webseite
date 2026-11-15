import { act, render, screen } from "@testing-library/react";

// Abstimmung live nur für angemeldete Mitglieder (#936): ohne Mitgliedschaft lädt das Popup gar nicht erst.

const auth = vi.hoisted(() => ({ value: { user: null, isClubMember: false } }));
const popup = vi.hoisted(() => ({ loaded: 0 }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("./BallotPopup", () => {
  popup.loaded += 1;
  return { BallotPopup: () => <div data-testid="ballot-popup-stub" /> };
});

const { BallotSlot } = await import("./BallotSlot");

const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

test("anonym und ohne Mitgliedschaft: kein Popup und kein Nachladen", async () => {
  const { rerender } = render(<BallotSlot />);
  await settle();
  auth.value = { user: { id: "u1" }, isClubMember: false };
  rerender(<BallotSlot />);
  await settle();
  expect(popup.loaded).toBe(0);
  expect(screen.queryByTestId("ballot-popup-stub")).toBeNull();
});

test("angemeldetes Mitglied: das Popup lädt und fragt wie bisher selbst nach offenen Abstimmungen", async () => {
  auth.value = { user: { id: "u1" }, isClubMember: true };
  render(<BallotSlot />);
  expect(await screen.findByTestId("ballot-popup-stub")).toBeInTheDocument();
  expect(popup.loaded).toBe(1);
});
