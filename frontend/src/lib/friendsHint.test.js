// Der einmalige Hinweis direkt nach der ersten Anmeldung (#1188 Teil 2): nur wenn der Server ihn fällig meldet, dann
// mit „Verstanden“ und „Ausschalten“; ein Fehler beim Fragen zeigt nichts.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { FRIENDS_HINT_TEXT, offerFriendsHint } = await import("./friendsHint");

beforeEach(() => {
  vi.clearAllMocks();
});

test("nicht fällig oder Fehler: kein Hinweis", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { due: false, sharing: true } });
  expect(await offerFriendsHint()).toBe(false);
  apiMock.get.mockRejectedValueOnce(new Error("offline"));
  expect(await offerFriendsHint()).toBe(false);
  expect(apiMock.get).toHaveBeenCalledWith("/users/me/friends-hint");
  expect(toastMock).not.toHaveBeenCalled();
});

test("fällig: einmal der Hinweis; „Ausschalten“ schaltet aus, „Verstanden“ bestätigt nur", async () => {
  apiMock.get.mockResolvedValue({ data: { due: true, sharing: true } });
  apiMock.post.mockResolvedValue({ data: { sharing: false } });
  expect(await offerFriendsHint()).toBe(true);
  expect(toastMock).toHaveBeenCalledTimes(1);
  const [text, options] = toastMock.mock.calls[0];
  expect(text).toBe(FRIENDS_HINT_TEXT);
  expect(options.id).toBe("tls-friends-hint");
  expect(options.duration).toBe(Infinity);
  expect(options.action.label).toBe("Ausschalten");
  expect(options.cancel.label).toBe("Verstanden");

  options.action.onClick();
  await vi.waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/me/friends-hint", { turn_off: true }));
  await vi.waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  options.cancel.onClick();
  await vi.waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/users/me/friends-hint", { turn_off: false }));
});
