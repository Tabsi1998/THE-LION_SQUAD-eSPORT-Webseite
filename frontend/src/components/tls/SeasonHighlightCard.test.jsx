import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

// Season-Highlight-Karte (#937): ein echter Dialog - der Fokus springt hinein und bleibt darin, Escape schließt und
// gibt ihn an „Karte“ zurück. Der Klick daneben schließt, ein Klick auf die Karte nicht.

vi.mock("html-to-image", () => ({ toPng: vi.fn(async () => "data:image/png;base64,") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { SeasonHighlightCard } = await import("./SeasonHighlightCard");

const PROFILE = { username: "leo", display_name: "Leo" };

function Harness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Karte</button>
      {open ? <SeasonHighlightCard profile={PROFILE} level={{ level: 3, points: 120 }} stats={{}} awards={[]} onClose={() => { onClose(); setOpen(false); }} /> : null}
    </>
  );
}

test("per Tastatur: Fokus in der Karte, Tab bleibt drin, Escape schließt mit Fokus zurück", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Karte" });
  opener.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Season-Highlight-Karte" });
  expect(dialog).toContainElement(document.activeElement);
  for (let i = 0; i < 5; i += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
  }
  expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
});

test("Klick daneben schließt, ein Klick auf die Karte nicht", () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Karte" }));
  fireEvent.click(screen.getByTestId("highlight-card"));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("highlight-card-modal"));
  expect(onClose).toHaveBeenCalledTimes(1);
});
