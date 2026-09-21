import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// 403 (#292): die Seite nennt den fehlenden Bereich und wer ihn vergibt.

vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));

const { ForbiddenPage } = await import("./ErrorPages");

test("mit Bereich aus der Weiterleitung steht er im Text", () => {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/403", state: { areas: ["content"] } }]}>
      <ForbiddenPage />
    </MemoryRouter>
  );
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Dafür fehlt dir der Bereich „Redaktion“. Vergeben kann ihn der Superadmin unter Admin → Alle Benutzer.");
});

test("ohne Angabe bleibt der allgemeine Text", () => {
  render(<MemoryRouter initialEntries={["/403"]}><ForbiddenPage /></MemoryRouter>);
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Du bist nicht berechtigt");
});
