// Ton ist Beiwerk (#2080): eine verweigerte oder fehlende Tonausgabe bleibt still - höchstens ein Debug-Hinweis je
// Sitzung, keine unbehandelte Ablehnung.

const deviceError = Object.assign(new Error("Failed to start the audio device"), { name: "NotAllowedError" });

async function freshModule() {
  vi.resetModules();
  return import("./audioSafe");
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

test("erkennt Ton-Probleme, andere verweigerte Rechte nicht", async () => {
  const { isAudioProblem } = await freshModule();
  expect(isAudioProblem(deviceError)).toBe(true);
  expect(isAudioProblem(new Error("play() failed because the user didn't interact with the document first."))).toBe(true);
  expect(isAudioProblem("The AudioContext was not allowed to start.")).toBe(true);
  expect(isAudioProblem(new Error("Write permission denied."))).toBe(false);
  expect(isAudioProblem(null)).toBe(false);
});

test("eine geworfene oder abgelehnte Ton-Aktion bleibt still, ein Debug-Hinweis je Sitzung", async () => {
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  const { attemptAudio } = await freshModule();
  expect(attemptAudio(() => { throw deviceError; }, false)).toBe(false);
  attemptAudio(() => Promise.reject(deviceError));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(debug).toHaveBeenCalledTimes(1);

  // Neues Seitenleben, dieselbe Sitzung: kein zweiter Hinweis.
  const again = await freshModule();
  again.attemptAudio(() => { throw deviceError; });
  expect(debug).toHaveBeenCalledTimes(1);
});
