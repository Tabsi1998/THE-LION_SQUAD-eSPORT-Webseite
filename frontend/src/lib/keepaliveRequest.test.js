import { API, keepaliveRequest } from "./api";

// Speichern beim Schließen des Tabs (#1048): fetch mit keepalive, Cookies und denselben Headern wie axios.

afterEach(() => {
  document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

test("schickt PATCH mit keepalive, Cookies, CSRF und dem erwarteten Konto", async () => {
  document.cookie = "csrf_token=abc%20123; path=/";
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "u-1", bio: "Hallo" }) }));
  vi.stubGlobal("fetch", fetchMock);
  const data = await keepaliveRequest("PATCH", "/users/me", { bio: "Hallo" }, { "X-Expected-User-Id": "u-1" });
  expect(data).toEqual({ id: "u-1", bio: "Hallo" });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`${API}/users/me`);
  expect(options).toMatchObject({ method: "PATCH", keepalive: true, credentials: "include", body: JSON.stringify({ bio: "Hallo" }) });
  expect(options.headers).toEqual({ "Content-Type": "application/json", "X-CSRF-Token": "abc 123", "X-Expected-User-Id": "u-1" });
  vi.unstubAllGlobals();
});

test("ein Fehler trägt Status und Antwort wie bei axios", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: "anderes Konto" }) })));
  await expect(keepaliveRequest("PATCH", "/users/me", {}, {})).rejects.toMatchObject({ response: { status: 409, data: { detail: "anderes Konto" } } });
  vi.unstubAllGlobals();
});
