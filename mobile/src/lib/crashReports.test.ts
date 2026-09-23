import { log, recordError as crashRecordError, setCrashlyticsCollectionEnabled } from "@react-native-firebase/crashlytics";
import { crashReportsEnabled, installCrashReporting, recordError } from "./crashReports";

// Absturzberichte (#219): im Entwicklungsmodus aus, sonst an; abgefangene Fehler gehen mit Ort und
// nur den Schlüsseln des Kontexts - nie mit Werten; ein Fehler in Crashlytics selbst bleibt stumm.

const setEnabled = setCrashlyticsCollectionEnabled as jest.Mock;
const record = crashRecordError as jest.Mock;
const logMock = log as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test("im Entwicklungsmodus aus: nichts wird gemeldet", async () => {
  expect(await installCrashReporting(true)).toBe(false);
  expect(setEnabled).toHaveBeenCalledWith(expect.anything(), false);
  recordError(new Error("kaputt"), "Test");
  expect(record).not.toHaveBeenCalled();
  expect(crashReportsEnabled()).toBe(false);
});

test("im Release an: Fehler mit Ort, vom Kontext nur die Schlüssel", async () => {
  expect(await installCrashReporting(false)).toBe(true);
  expect(setEnabled).toHaveBeenCalledWith(expect.anything(), true);
  const error = new Error("kaputt");
  recordError(error, "AppErrorBoundary", { componentStack: "geheim <Screen>", email: "x@y.z" });
  expect(logMock).toHaveBeenCalledWith(expect.anything(), "AppErrorBoundary: componentStack,email");
  expect(record).toHaveBeenCalledWith(expect.anything(), error, "AppErrorBoundary");
  expect(JSON.stringify(logMock.mock.calls)).not.toContain("geheim");

  recordError("nur Text", "irgendwo");
  expect(record).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ message: "nur Text" }), "irgendwo");
});

test("ein Fehler in Crashlytics selbst bleibt stumm", async () => {
  await installCrashReporting(false);
  record.mockImplementationOnce(() => { throw new Error("Firebase kaputt"); });
  expect(() => recordError(new Error("x"))).not.toThrow();
  setEnabled.mockRejectedValueOnce(new Error("kein Firebase"));
  expect(await installCrashReporting(false)).toBe(false);
  expect(crashReportsEnabled()).toBe(false);
});
