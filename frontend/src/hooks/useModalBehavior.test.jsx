import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useModalBehavior } from "./useModalBehavior";

function Overlay({ onDismiss, withInput = false }) {
  const ref = useModalBehavior(true, onDismiss);
  return (
    <div ref={ref} tabIndex={-1} data-testid="overlay">
      {withInput ? <input aria-label="Grund" /> : null}
      <button type="button">Erste</button>
      <button type="button">Letzte</button>
    </div>
  );
}

function Harness({ withInput = false }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Öffnen</button>
      {open ? <Overlay onDismiss={() => setOpen(false)} withInput={withInput} /> : null}
    </div>
  );
}

test("Escape schließt das Overlay", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  render(<Overlay onDismiss={onDismiss} />);

  await user.keyboard("{Escape}");

  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test("Fokus wandert beim Öffnen in das Overlay", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Öffnen" }));

  expect(screen.getByRole("button", { name: "Erste" })).toHaveFocus();
});

test("Ein Eingabefeld bekommt den Fokus vor den Schaltflächen", async () => {
  const user = userEvent.setup();
  render(<Harness withInput />);

  await user.click(screen.getByRole("button", { name: "Öffnen" }));

  expect(screen.getByLabelText("Grund")).toHaveFocus();
});

test("Tab bleibt im Overlay und springt vom letzten zum ersten Element", async () => {
  const user = userEvent.setup();
  render(<Overlay onDismiss={() => {}} />);
  const first = screen.getByRole("button", { name: "Erste" });
  const last = screen.getByRole("button", { name: "Letzte" });

  expect(first).toHaveFocus();
  await user.tab();
  expect(last).toHaveFocus();
  await user.tab();
  expect(first).toHaveFocus();
});

test("Shift+Tab springt vom ersten zum letzten Element", async () => {
  const user = userEvent.setup();
  render(<Overlay onDismiss={() => {}} />);

  expect(screen.getByRole("button", { name: "Erste" })).toHaveFocus();
  await user.tab({ shift: true });

  expect(screen.getByRole("button", { name: "Letzte" })).toHaveFocus();
});

test("Nach dem Schließen kehrt der Fokus zum auslösenden Element zurück", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Öffnen" });

  await user.click(opener);
  expect(screen.getByRole("button", { name: "Erste" })).toHaveFocus();

  await user.keyboard("{Escape}");

  expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test("Ein inaktives Overlay fängt keine Tastatureingaben ab", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();

  function Inactive() {
    const ref = useModalBehavior(false, onDismiss);
    return <div ref={ref}><button type="button">Egal</button></div>;
  }

  render(<Inactive />);
  await user.keyboard("{Escape}");

  expect(onDismiss).not.toHaveBeenCalled();
});

// #937: hat eine Aktion den Fokus schon bewusst woanders hingesetzt (Bild einfügen setzt ihn zurück in den Editor),
// holt das Schließen ihn nicht zum auslösenden Knopf zurück.
test("Hat eine Aktion den Fokus schon hinausgesetzt, bleibt er dort", async () => {
  const user = userEvent.setup();

  function Picker({ onPick }) {
    const ref = useModalBehavior(true, onPick);
    return <div ref={ref}><button type="button" onClick={onPick}>Einfügen</button></div>;
  }
  function Editor() {
    const [open, setOpen] = useState(false);
    const pick = () => {
      document.getElementById("text").focus();
      setOpen(false);
    };
    return (
      <div>
        <textarea id="text" aria-label="Text" />
        <button type="button" onClick={() => setOpen(true)}>Bild</button>
        {open ? <Picker onPick={pick} /> : null}
      </div>
    );
  }

  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Bild" }));
  await user.click(screen.getByRole("button", { name: "Einfügen" }));

  expect(screen.getByLabelText("Text")).toHaveFocus();
});
