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

// #2412: hinter einem offenen modalen Overlay ist der Rest der Seite gesperrt (`inert`) - für Maus, Tastatur und
// Vorleseprogramm. Meldungen (Toasts, aria-live) bleiben erreichbar, nach dem Schließen ist alles wieder frei.
function ModalOverlay({ onDismiss = () => {}, children = null }) {
  const ref = useModalBehavior(true, onDismiss);
  return (
    <div role="presentation" data-testid="backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Fenster" data-testid="modal">
        <button type="button">Im Fenster</button>
        {children}
      </div>
    </div>
  );
}

function Page({ initiallyOpen = false, overlay = null }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div>
      <main data-testid="page"><button type="button" onClick={() => setOpen(true)}>Öffnen</button></main>
      <section aria-live="polite" data-testid="live" />
      {open ? (overlay ? overlay(() => setOpen(false)) : <ModalOverlay onDismiss={() => setOpen(false)} />) : null}
    </div>
  );
}

test("Ein modales Overlay sperrt den Hintergrund und gibt ihn beim Schließen frei", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "Öffnen" }));
  expect(screen.getByTestId("page")).toHaveAttribute("inert");
  expect(screen.getByTestId("modal")).not.toHaveAttribute("inert");
  expect(screen.getByTestId("backdrop")).not.toHaveAttribute("inert");

  await user.keyboard("{Escape}");
  expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
});

test("Meldungsbereiche (aria-live) bleiben hinter dem Overlay erreichbar", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "Öffnen" }));

  expect(screen.getByTestId("live")).not.toHaveAttribute("inert");
});

test("Was schon vorher gesperrt war, bleibt nach dem Schließen gesperrt", async () => {
  const user = userEvent.setup();
  render(
    <>
      <div data-testid="already" inert />
      <Page />
    </>,
  );

  await user.click(screen.getByRole("button", { name: "Öffnen" }));
  await user.keyboard("{Escape}");

  expect(screen.getByTestId("already")).toHaveAttribute("inert");
});

test("Ein nicht modales Overlay (ohne aria-modal) sperrt nichts", async () => {
  function Drawer() {
    const ref = useModalBehavior(true, () => {});
    return <aside ref={ref}><button type="button">Menü</button></aside>;
  }
  render(<><main data-testid="page" /><Drawer /></>);

  expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
});

test("Verschachtelt: Escape schließt nur das obere Overlay, der Hintergrund des unteren bleibt gesperrt", async () => {
  const user = userEvent.setup();
  const outerDismiss = vi.fn();

  function Inner({ onDismiss }) {
    const ref = useModalBehavior(true, onDismiss);
    return <div ref={ref} role="dialog" aria-modal="true" aria-label="Innen" data-testid="inner"><button type="button">Innen</button></div>;
  }
  function Outer() {
    const [inner, setInner] = useState(false);
    const ref = useModalBehavior(true, outerDismiss);
    return (
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Außen" data-testid="outer">
        <button type="button" onClick={() => setInner(true)}>Innen öffnen</button>
        <p data-testid="outer-text">Text</p>
        {inner ? <Inner onDismiss={() => setInner(false)} /> : null}
      </div>
    );
  }
  render(<><main data-testid="page" /><Outer /></>);

  await user.click(screen.getByRole("button", { name: "Innen öffnen" }));
  expect(screen.getByTestId("outer-text")).toHaveAttribute("inert");

  await user.keyboard("{Escape}");
  expect(screen.queryByTestId("inner")).not.toBeInTheDocument();
  expect(outerDismiss).not.toHaveBeenCalled();
  expect(screen.getByTestId("outer-text")).not.toHaveAttribute("inert");
  expect(screen.getByTestId("page")).toHaveAttribute("inert");
  expect(screen.getByRole("button", { name: "Innen öffnen" })).toHaveFocus();
});

test("Escape gehört einer aufgeklappten Auswahl außerhalb des Overlays, nicht dem Overlay", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  render(<ModalOverlay onDismiss={onDismiss} />);
  // Eine Auswahlliste (z. B. Radix) hängt sich nach dem Öffnen an den body und bekommt den Fokus, solange sie offen ist.
  const popover = document.createElement("div");
  popover.innerHTML = '<button type="button">Wahl</button>';
  document.body.appendChild(popover);
  popover.querySelector("button").focus();

  await user.keyboard("{Escape}");

  expect(onDismiss).not.toHaveBeenCalled();
  popover.remove();
});

// #2412: Seitenblätter setzen den Fokus auf das Blatt selbst - das Vorleseprogramm liest den Titel, Tab führt zum
// ersten Feld, Shift+Tab bleibt im Blatt.
test("focusContainer: der Fokus steht auf dem Overlay selbst, Tab und Shift+Tab bleiben drin", async () => {
  const user = userEvent.setup();
  function Sheet() {
    const ref = useModalBehavior(true, () => {}, { focusContainer: true });
    return (
      <div ref={ref} tabIndex={-1} data-testid="sheet">
        <button type="button">Erste</button>
        <button type="button">Letzte</button>
      </div>
    );
  }
  render(<><button type="button">Draußen</button><Sheet /></>);

  expect(screen.getByTestId("sheet")).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Letzte" })).toHaveFocus();
  screen.getByTestId("sheet").focus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Erste" })).toHaveFocus();
});

// #2412: eine Gruppe von Optionsfeldern ist ein einziger Tab-Halt. Steht der Fokus auf einer anderen als der ersten
// Option, darf Shift+Tab trotzdem nicht aus dem Overlay herausfallen.
test("Optionsfelder am Rand: Shift+Tab und Tab bleiben im Overlay", async () => {
  const user = userEvent.setup();
  function Choice() {
    const ref = useModalBehavior(true, () => {});
    return (
      <div ref={ref}>
        <input type="radio" name="team" aria-label="Löwen" />
        <input type="radio" name="team" aria-label="Falken" />
        <button type="button">Weiter</button>
      </div>
    );
  }
  render(<><button type="button">Draußen</button><Choice /></>);

  screen.getByLabelText("Falken").focus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Weiter" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("radio", { name: "Löwen" }).matches(":focus") || screen.getByRole("radio", { name: "Falken" }).matches(":focus")).toBe(true);
});

// #2412: eine Auswahl, die ein Feld im Overlay aufklappt (Radix-Popover am body, z. B. der Kalender im Datumsfeld), ist
// nicht gesperrt und behält ihre Tab-Reihenfolge - die Falle holt den Fokus nicht ins Overlay zurück.
test("Tab in einer aufgeklappten Auswahl außerhalb des modalen Overlays bleibt dort", async () => {
  const user = userEvent.setup();
  render(<ModalOverlay />);
  const popover = document.createElement("div");
  popover.innerHTML = '<button type="button">Mai</button><button type="button">Juni</button>';
  document.body.appendChild(popover);
  const [may, june] = popover.querySelectorAll("button");
  may.focus();

  await user.tab();

  expect(june).toHaveFocus();
  popover.remove();
});

// Fix-Runde #2412: schließt eine Aktion im inneren Dialog auch das Blatt darunter (beide im selben Durchgang), geht der
// Fokus an den Knopf zurück, der das Blatt geöffnet hat - nicht verloren an einen verschwundenen oder gesperrten Knopf.
test("Dialog im Blatt, beide schließen zugleich: der Fokus kehrt zum Auslöser des Blatts zurück", async () => {
  const user = userEvent.setup();
  function Inner({ onDone }) {
    const ref = useModalBehavior(true, () => {});
    return <div ref={ref} role="dialog" aria-modal="true" aria-label="Innen"><button type="button" onClick={onDone}>Fertig</button></div>;
  }
  function Sheet({ onClose }) {
    const [inner, setInner] = useState(false);
    const ref = useModalBehavior(true, onClose);
    return (
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Blatt">
        <button type="button" onClick={() => setInner(true)}>Bild wählen</button>
        {inner ? <Inner onDone={onClose} /> : null}
      </div>
    );
  }
  function App() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <main data-testid="page"><button type="button" onClick={() => setOpen(true)}>Bearbeiten</button></main>
        {open ? <Sheet onClose={() => setOpen(false)} /> : null}
      </>
    );
  }
  // Wie im Browser: ein Element unter `inert` (oder nicht mehr im Dokument) nimmt keinen Fokus an.
  const realFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focusUnlessInert(...args) {
    if (!this.isConnected || this.closest("[inert]")) return;
    realFocus.apply(this, args);
  };
  try {
    render(<App />);
    const opener = screen.getByRole("button", { name: "Bearbeiten" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Bild wählen" }));
    await user.click(screen.getByRole("button", { name: "Fertig" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  } finally {
    HTMLElement.prototype.focus = realFocus;
  }
});

// Fix-Runde #2412: setzt React selbst `inert` auf ein Element, während das Overlay es gesperrt hat (die eingeklappte
// Admin-Leiste beim Wechsel aufs Handy), bleibt es nach dem Schließen gesperrt - das Overlay gibt nur frei, was es selbst
// gesperrt hat und was inzwischen niemand anders gesperrt hat.
test("Was React während des Overlays selbst sperrt, bleibt nach dem Schließen gesperrt", async () => {
  const user = userEvent.setup();
  function App() {
    const [open, setOpen] = useState(false);
    const [hidden, setHidden] = useState(false);
    return (
      <>
        <aside data-testid="drawer" inert={hidden}><button type="button">Menü</button></aside>
        <main><button type="button" onClick={() => setOpen(true)}>Öffnen</button></main>
        {open ? (
          <ModalOverlay onDismiss={() => setOpen(false)}>
            <button type="button" onClick={() => setHidden(true)}>Leiste einklappen</button>
          </ModalOverlay>
        ) : null}
      </>
    );
  }
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Öffnen" }));
  expect(screen.getByTestId("drawer")).toHaveAttribute("inert");
  await user.click(screen.getByRole("button", { name: "Leiste einklappen" }));
  await user.keyboard("{Escape}");

  expect(screen.getByTestId("drawer")).toHaveAttribute("inert");
});
