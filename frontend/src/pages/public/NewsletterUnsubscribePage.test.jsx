import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Newsletter abbestellen (#2119 ML4): erst der Knopf meldet ab - das Öffnen des Links allein nicht.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const NewsletterUnsubscribePage = (await import("./NewsletterUnsubscribePage")).default;

function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><NewsletterUnsubscribePage /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

test("Öffnen allein meldet nicht ab; der Knopf schon", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true, already: false } });
  const user = userEvent.setup();
  open("/newsletter/abbestellen?token=u1.sig");
  expect(apiMock.post).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("newsletter-unsubscribe-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/newsletter/unsubscribe?token=u1.sig"));
  expect(await screen.findByText("Erledigt – du bekommst keinen Newsletter mehr.")).toBeInTheDocument();
});

test("Schon abgemeldet und ungültiger Link sagen es klar", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, already: true } });
  const { unmount } = open("/newsletter/abbestellen?token=u1.sig");
  await user.click(screen.getByTestId("newsletter-unsubscribe-confirm"));
  expect(await screen.findByText("Du warst schon abgemeldet – es kommt kein Newsletter mehr.")).toBeInTheDocument();
  unmount();

  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Der Abmeldelink ist ungültig." } } });
  open("/newsletter/abbestellen?token=kaputt");
  await user.click(screen.getByTestId("newsletter-unsubscribe-confirm"));
  expect(await screen.findByText("Der Abmeldelink ist ungültig.")).toBeInTheDocument();
});

test("Ohne Schlüssel kein Knopf, sondern der Weg übers Profil", () => {
  open("/newsletter/abbestellen");
  expect(screen.queryByTestId("newsletter-unsubscribe-confirm")).toBeNull();
  expect(screen.getByText(/Im Link fehlt der Schlüssel/)).toBeInTheDocument();
});
