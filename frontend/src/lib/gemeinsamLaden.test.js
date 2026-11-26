// Ein Abruf für zwei Stellen (#2059): Rahmen und Seite von „Mein Bereich“ fragen beim Öffnen dasselbe - einmal reicht.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const { gemeinsamLaden, gemeinsamVergessen } = await import("./gemeinsamLaden");

afterEach(() => {
  gemeinsamVergessen();
  apiMock.get.mockReset();
  vi.useRealTimers();
});

test("gleichzeitig und kurz danach: ein Abruf, dieselbe Antwort", async () => {
  apiMock.get.mockResolvedValue({ data: { summary: { open_count: 1 } } });
  const [a, b] = await Promise.all([gemeinsamLaden("/account/invoices"), gemeinsamLaden("/account/invoices")]);
  const c = await gemeinsamLaden("/account/invoices");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  expect(a.data).toEqual(b.data);
  expect(c.data.summary.open_count).toBe(1);
});

test("nach einer Weile, nach „vergessen“ oder mit frisch: neu abrufen", async () => {
  vi.useFakeTimers();
  apiMock.get.mockResolvedValue({ data: {} });
  await gemeinsamLaden("/membership/me");
  vi.advanceTimersByTime(5000);
  await gemeinsamLaden("/membership/me");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  gemeinsamVergessen("/membership/me");
  await gemeinsamLaden("/membership/me");
  await gemeinsamLaden("/membership/me", { frisch: true });
  expect(apiMock.get).toHaveBeenCalledTimes(4);
});

test("ein Fehler bleibt nicht hängen: der nächste Aufruf fragt neu", async () => {
  apiMock.get.mockRejectedValueOnce(new Error("weg")).mockResolvedValueOnce({ data: { ok: true } });
  await expect(gemeinsamLaden("/membership/area-summary")).rejects.toThrow("weg");
  expect((await gemeinsamLaden("/membership/area-summary")).data.ok).toBe(true);
});
