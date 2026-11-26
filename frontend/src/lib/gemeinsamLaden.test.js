// Ein Abruf für zwei Stellen (#2059): Rahmen und Seite von „Mein Bereich“ fragen beim Öffnen dasselbe - einmal reicht.
// Geteilt wird nur innerhalb eines Kontos (Prüfung #2059): nach dem Abmelden oder mit einem anderen Konto nie die
// Antwort des vorigen, auch nicht eine, die noch unterwegs war.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const { gemeinsamKonto, gemeinsamLaden, gemeinsamVergessen, istVerworfen } = await import("./gemeinsamLaden");

const KONTO = { konto: "u-1" };

afterEach(() => {
  gemeinsamVergessen();
  apiMock.get.mockReset();
  vi.useRealTimers();
});

function spaeter() {
  let antworte;
  const promise = new Promise((resolve) => { antworte = resolve; });
  return { promise, antworte };
}

test("gleichzeitig und kurz danach: ein Abruf, dieselbe Antwort", async () => {
  apiMock.get.mockResolvedValue({ data: { summary: { open_count: 1 } } });
  const [a, b] = await Promise.all([gemeinsamLaden("/account/invoices", KONTO), gemeinsamLaden("/account/invoices", KONTO)]);
  const c = await gemeinsamLaden("/account/invoices", KONTO);
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  expect(a.data).toEqual(b.data);
  expect(c.data.summary.open_count).toBe(1);
});

test("nach einer Weile, nach „vergessen“ oder mit frisch: neu abrufen", async () => {
  vi.useFakeTimers();
  apiMock.get.mockResolvedValue({ data: {} });
  await gemeinsamLaden("/membership/me", KONTO);
  vi.advanceTimersByTime(5000);
  await gemeinsamLaden("/membership/me", KONTO);
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  gemeinsamVergessen("/membership/me");
  await gemeinsamLaden("/membership/me", KONTO);
  await gemeinsamLaden("/membership/me", { ...KONTO, frisch: true });
  expect(apiMock.get).toHaveBeenCalledTimes(4);
});

test("ein Fehler bleibt nicht hängen: der nächste Aufruf fragt neu", async () => {
  apiMock.get.mockRejectedValueOnce(new Error("weg")).mockResolvedValueOnce({ data: { ok: true } });
  await expect(gemeinsamLaden("/membership/area-summary", KONTO)).rejects.toThrow("weg");
  expect((await gemeinsamLaden("/membership/area-summary", KONTO)).data.ok).toBe(true);
});

test("A wartet auf seine Rechnungen, meldet sich ab, B meldet sich an: B bekommt nie die Belege von A", async () => {
  const anfrageA = spaeter();
  apiMock.get
    .mockImplementationOnce(() => anfrageA.promise)
    .mockResolvedValueOnce({ data: { invoices: [{ ref: "RE-B-0002" }] } });
  const a = gemeinsamLaden("/account/invoices", { konto: "u-a" });
  // Abmelden (AuthContext): alles vergessen.
  gemeinsamKonto(null);
  const b = gemeinsamLaden("/account/invoices", { konto: "u-b" });
  // Die Antwort für A kommt erst jetzt - nach dem Abmelden.
  anfrageA.antworte({ data: { invoices: [{ ref: "RE-A-0001" }] } });
  expect((await b).data.invoices[0].ref).toBe("RE-B-0002");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  // Was nach dem Abmelden eintrifft, wird verworfen - auch für die Stelle, die noch auf A wartete.
  const fehler = await a.catch((err) => err);
  expect(istVerworfen(fehler)).toBe(true);
  // Und B bekommt danach weiter seine eigenen Belege aus der Ablage, nicht die von A.
  expect((await gemeinsamLaden("/account/invoices", { konto: "u-b" })).data.invoices[0].ref).toBe("RE-B-0002");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("ein anderes Konto ohne Abmelden (etwa nach abgelaufener Sitzung): eigene Anfrage, die alte Antwort verfällt", async () => {
  const anfrageA = spaeter();
  apiMock.get
    .mockImplementationOnce(() => anfrageA.promise)
    .mockResolvedValueOnce({ data: { ref: "B" } });
  const a = gemeinsamLaden("/membership/me", { konto: "u-a" });
  const b = gemeinsamLaden("/membership/me", { konto: "u-b" });
  anfrageA.antworte({ data: { ref: "A" } });
  expect((await b).data.ref).toBe("B");
  expect(istVerworfen(await a.catch((err) => err))).toBe(true);
});

test("Abmelden mitten in der Anfrage: die Antwort für A kommt bei niemandem mehr an", async () => {
  const anfrageA = spaeter();
  apiMock.get.mockImplementationOnce(() => anfrageA.promise);
  const a = gemeinsamLaden("/account/invoices", { konto: "u-a" });
  gemeinsamVergessen();
  anfrageA.antworte({ data: { ref: "A" } });
  expect(istVerworfen(await a.catch((err) => err))).toBe(true);
});

test("ohne Konto wird nichts geteilt", async () => {
  apiMock.get.mockResolvedValue({ data: {} });
  await Promise.all([gemeinsamLaden("/account/invoices"), gemeinsamLaden("/account/invoices")]);
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("dasselbe Konto noch einmal melden ändert nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { ref: "A" } });
  const a = gemeinsamLaden("/account/invoices", { konto: "u-a" });
  gemeinsamKonto("u-a");
  expect((await a).data.ref).toBe("A");
  await gemeinsamLaden("/account/invoices", { konto: "u-a" });
  expect(apiMock.get).toHaveBeenCalledTimes(1);
});
