import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharePreviewToggle, sharePreviewHint } from "./SharePreviewToggle";

// Vorschau beim Teilen (#347): den Haken gibt es nur, wo er etwas bedeutet – und nie für Internes.

test("für Mitglieder-Inhalte lässt sich Titel und Bild erlauben", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<SharePreviewToggle visibility="members" checked={false} onChange={onChange} />);
  expect(screen.getByTestId("share-preview-hint")).toHaveTextContent("nur eine neutrale Karte");
  await user.click(screen.getByTestId("share-preview-toggle"));
  expect(onChange).toHaveBeenCalledWith(true);
});

test("öffentlich braucht den Haken nicht, intern bekommt ihn nie", () => {
  const { rerender } = render(<SharePreviewToggle visibility="public" checked={false} onChange={() => {}} />);
  expect(screen.queryByTestId("share-preview-toggle")).toBeNull();
  expect(screen.getByTestId("share-preview-hint")).toHaveTextContent("Öffentlich");
  rerender(<SharePreviewToggle visibility="internal" checked onChange={() => {}} />);
  expect(screen.queryByTestId("share-preview-toggle")).toBeNull();
  expect(screen.getByTestId("share-preview-hint")).toHaveTextContent("nie Titel oder Bild");
  expect(sharePreviewHint("members", true)).toMatch(/Titel, Datum und Bild/);
});

test("„Nur App“ (#1532): beim Teilen nur die Karte „News in der LionsAPP“, ohne Haken", () => {
  expect(sharePreviewHint("public", false, true)).toBe("Nur App: Beim Teilen erscheint nur „News in der LionsAPP“ – ohne Titel und Bild, nie bei Google.");
  render(<SharePreviewToggle visibility="members" checked={false} onChange={() => {}} appOnly />);
  expect(screen.queryByTestId("share-preview-toggle")).toBeNull();
  expect(screen.getByTestId("share-preview-hint")).toHaveTextContent("Nur App");
});
