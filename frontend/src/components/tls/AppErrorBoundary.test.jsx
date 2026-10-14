import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppErrorBoundary, OptionalBoundary, RootErrorBoundary } from "./AppErrorBoundary";

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

// #986: optionale Teile über jeder Seite (Abstimmung, Zeremonie, Saison) reißen bei einem Fehler nicht die Seite mit,
// und ein Fehler ganz außen (Provider, Router) hat eine eigene Karte statt eines leeren #root.
describe("OptionalBoundary", () => {
  beforeEach(() => {
    report.mockReset();
    report.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  function Probe() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate("/events")}>weiter</button>;
  }

  function Flaky({ broken }) {
    const { pathname } = useLocation();
    if (broken.has(pathname)) throw new Error("ballots.filter is not a function");
    return <p>Popup auf {pathname}</p>;
  }

  it("blendet nur den kaputten Teil aus, die Seite daneben bleibt, der Fehler wird gemeldet", () => {
    render(
      <MemoryRouter initialEntries={["/news"]}>
        <OptionalBoundary name="BallotPopup"><Broken /></OptionalBoundary>
        <main data-testid="seite">News</main>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("seite")).toHaveTextContent("News");
    expect(screen.queryByTestId("page-error")).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].message).toBe("list.filter is not a function");
  });

  it("versucht es auf der nächsten Seite wieder", () => {
    const broken = new Set(["/news"]);
    render(
      <MemoryRouter initialEntries={["/news"]}>
        <OptionalBoundary name="SeasonStage"><Flaky broken={broken} /></OptionalBoundary>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Popup auf/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "weiter" }));
    expect(screen.getByText("Popup auf /events")).toBeInTheDocument();
  });
});

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    report.mockReset();
    report.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("fängt einen Fehler außerhalb des Routers mit einer eigenen Karte - Neu laden und Startseite ohne Router", () => {
    render(<RootErrorBoundary><Broken /></RootErrorBoundary>);
    const card = screen.getByTestId("root-error");
    expect(card).toHaveTextContent("Die Website konnte nicht angezeigt werden");
    expect(card).not.toHaveTextContent("list.filter");
    expect(within(card).getByRole("button", { name: /Neu laden/ })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Startseite/ })).toHaveAttribute("href", "/");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("zeigt die gesunde Website unverändert", () => {
    render(<RootErrorBoundary><p>Alles gut</p></RootErrorBoundary>);
    expect(screen.getByText("Alles gut")).toBeInTheDocument();
    expect(screen.queryByTestId("root-error")).toBeNull();
  });
});
