import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppErrorBoundary } from "./AppErrorBoundary";

// #944: ein Fehler beim Zeichnen einer Seite zeigt einen Hinweis mit „Neu laden“ - Kopf und Footer bleiben stehen.

const layout = vi.hoisted(() => ({ broken: false }));
vi.mock("@/components/tls/PublicLayout", () => ({
  PublicLayout: ({ children }) => {
    if (layout.broken) throw new Error("Rahmen kaputt");
    return (
      <div>
        <header data-testid="kopf">Kopfzeile</header>
        <main>{children}</main>
        <footer data-testid="footer">Footer</footer>
      </div>
    );
  },
}));
const report = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clientLog", async (importOriginal) => ({ ...(await importOriginal()), reportCaughtError: report }));
// #1230: wer die technischen Angaben sieht, hängt am Konto - Gast, Spieler oder Admin.
const auth = vi.hoisted(() => ({ current: null }));
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => auth.current }));

function Broken() {
  throw new Error("list.filter is not a function");
}

function show(path, child = <Broken />) {
  return render(<MemoryRouter initialEntries={[path]}><AppErrorBoundary>{child}</AppErrorBoundary></MemoryRouter>);
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    layout.broken = false;
    auth.current = null;
    report.mockReset();
    report.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("zeigt bei einem Seitenfehler den Hinweis zwischen Kopf und Footer und meldet den Fehler", () => {
    show("/news");
    expect(screen.getByTestId("page-error")).toHaveTextContent("Diese Seite konnte nicht angezeigt werden");
    expect(screen.getByRole("button", { name: /Neu laden/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Startseite/ })).toHaveAttribute("href", "/");
    expect(screen.getByTestId("kopf")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].message).toBe("list.filter is not a function");
  });

  it("bleibt bei der schlichten Karte, wenn auch der Rahmen abstürzt", () => {
    layout.broken = true;
    show("/news");
    expect(screen.getByTestId("page-error")).toBeInTheDocument();
    expect(screen.queryByTestId("kopf")).toBeNull();
  });

  it("nimmt im Adminbereich die schlichte Karte, ohne den öffentlichen Rahmen", () => {
    show("/admin/news");
    expect(screen.getByTestId("page-error")).toBeInTheDocument();
    expect(screen.queryByTestId("kopf")).toBeNull();
  });

  it("zeigt gesunde Seiten unverändert", () => {
    show("/news", <p>Alles gut</p>);
    expect(screen.getByText("Alles gut")).toBeInTheDocument();
    expect(screen.queryByTestId("page-error")).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("zeigt Gästen und Spielern keinen Programmierer-Text, auch keine zugeklappten Angaben", async () => {
    show("/news");
    expect(screen.getByTestId("page-error")).not.toHaveTextContent("list.filter");
    expect(screen.queryByTestId("page-error-details")).toBeNull();
    auth.current = { user: { id: "u1", role: "player" }, isAdmin: false, can: () => false };
    show("/news");
    expect(screen.queryByTestId("page-error-details")).toBeNull();
    await act(async () => {});
  });

  it("zeigt Admins die technischen Angaben zugeklappt, mit Kennung, Seite und Uhrzeit zum Kopieren", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:15:30Z"));
    auth.current = { user: { id: "a1", role: "superadmin" }, isAdmin: true, can: (area) => area === "system" };
    report.mockResolvedValue("log-4711");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    show("/news");
    const details = screen.getByTestId("page-error-details");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("Technische Angaben (für Admins)")).toBeInTheDocument();
    await act(async () => {});
    const text = screen.getByTestId("page-error-technical");
    expect(text).toHaveTextContent("Fehler: Error: list.filter is not a function");
    expect(text).toHaveTextContent("Seite: /");
    expect(text).toHaveTextContent("Uhrzeit: 7.10.2026, 12:15:30");
    expect(text).toHaveTextContent("Kennung: log-4711");
    expect(screen.getByTestId("page-error-log-link")).toHaveAttribute("href", "/admin/ops?tab=app&q=log-4711");
    await act(async () => { fireEvent.click(screen.getByTestId("page-error-copy")); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Kennung: log-4711"));
    expect(screen.getByTestId("page-error-copied")).toHaveTextContent("Kopiert");
  });

  it("nennt ohne Bereich System keinen Weg zu Betrieb & Logs und sagt, wenn die Meldung nicht ankam", async () => {
    auth.current = { user: { id: "t1", role: "tournament_admin" }, isAdmin: true, can: () => false };
    report.mockResolvedValue(null);
    show("/news");
    await act(async () => {});
    expect(screen.getByTestId("page-error-technical")).toHaveTextContent("Kennung: nicht gemeldet");
    expect(screen.queryByTestId("page-error-log-link")).toBeNull();
  });
});
