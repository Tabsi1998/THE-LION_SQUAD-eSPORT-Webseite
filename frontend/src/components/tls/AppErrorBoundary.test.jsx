import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("@/lib/clientLog", () => ({ reportCaughtError: report }));

function Broken() {
  throw new Error("list.filter is not a function");
}

function show(path, child = <Broken />) {
  return render(<MemoryRouter initialEntries={[path]}><AppErrorBoundary>{child}</AppErrorBoundary></MemoryRouter>);
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    layout.broken = false;
    report.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

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
});
