import { Platform } from "react-native";

// Dokumente der Vereinsakte in der App (#849): im Cache unter ihrer Prüfsumme, vor jedem Öffnen eine Nachfrage
// (304 = keine neue Datei), eine neue Fassung ersetzt die alte, ein entzogenes Dokument verschwindet, ein
// abgebrochener Download geht beim nächsten Tipp weiter.

type Answer = { status: number } | Error;
const mockFiles = new Set<string>();
const mockAnswers: Answer[] = [];
const mockTasks: Array<{ url: string; uri: string; headers: Record<string, string>; resumeData?: string; resumed: boolean }> = [];
let mockResumeData: string | null = null;

const mockFs = {
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.delete(from);
    mockFiles.add(to);
  }),
  getContentUriAsync: jest.fn(async (uri: string) => `content://${uri}`),
  createDownloadResumable: jest.fn((url: string, uri: string, options?: { headers?: Record<string, string> }, _callback?: unknown, resumeData?: string) => {
    const task = { url, uri, headers: options?.headers || {}, resumeData, resumed: false };
    mockTasks.push(task);
    const run = async () => {
      const answer = mockAnswers.shift() || { status: 200 };
      if (answer instanceof Error) throw answer;
      if (answer.status === 200 || answer.status === 206) mockFiles.add(uri);
      return { uri, status: answer.status };
    };
    return {
      downloadAsync: run,
      resumeAsync: async () => {
        task.resumed = true;
        return run();
      },
      pauseAsync: async () => ({ resumeData: mockResumeData }),
      savable: () => ({ resumeData: mockResumeData }),
    };
  }),
};
jest.mock("expo-file-system/legacy", () => mockFs);
const mockLauncher = { startActivityAsync: jest.fn(async () => ({})) };
jest.mock("expo-intent-launcher", () => mockLauncher);

const { cleanChecksum, forgetDocuments, openDocument, resetDocumentDownloads } = require("./memberDocuments");

const SHA = "a".repeat(64);
const TARGET = `file:///cache/member-documents/sha-${SHA}.pdf`;
const DOC = { id: "dolibarr-3", source: "dolibarr", mime: "application/pdf", original_filename: "DOC03-1.pdf", view_url: "/api/documents/dolibarr-3/view", checksum: SHA };

beforeEach(() => {
  Platform.OS = "android";
  mockFiles.clear();
  mockAnswers.length = 0;
  mockTasks.length = 0;
  mockResumeData = null;
  resetDocumentDownloads();
  jest.clearAllMocks();
});

test("Prüfsumme: nur 64 Hex-Zeichen zählen", () => {
  expect(cleanChecksum(SHA.toUpperCase())).toBe(SHA);
  expect(cleanChecksum("../../etc")).toBe("");
  expect(cleanChecksum(null)).toBe("");
});

test("erstes Öffnen lädt unter der Prüfsumme; danach fragt die App nach und öffnet bei 304 ohne neuen Download", async () => {
  await openDocument(DOC, "tok");
  expect(mockTasks[0].uri).toBe(`file:///cache/member-documents/sha-${SHA}.part`);
  expect(mockTasks[0].headers).toEqual({ Authorization: "Bearer tok" });
  expect(mockFiles.has(TARGET)).toBe(true);
  expect(mockLauncher.startActivityAsync).toHaveBeenCalledWith("android.intent.action.VIEW", expect.objectContaining({ data: `content://${TARGET}`, type: "application/pdf" }));

  mockAnswers.push({ status: 304 });
  await openDocument(DOC, "tok");
  expect(mockTasks[1].headers["If-None-Match"]).toBe(`"${SHA}"`);
  expect(mockFiles.has(`file:///cache/member-documents/sha-${SHA}.check`)).toBe(false);
  expect(mockLauncher.startActivityAsync).toHaveBeenCalledTimes(2);
});

test("eine neue Fassung ersetzt die alte; ein entzogenes Dokument verschwindet aus dem Cache", async () => {
  mockFiles.add(TARGET);
  mockAnswers.push({ status: 200 });
  await openDocument(DOC, "tok");
  expect(mockFs.moveAsync).toHaveBeenCalledWith({ from: `file:///cache/member-documents/sha-${SHA}.check`, to: TARGET });

  mockAnswers.push({ status: 404 });
  await expect(openDocument(DOC, "tok")).rejects.toThrow("Die Datei fehlt auf dem Server");
  expect(mockFiles.has(TARGET)).toBe(false);
});

test("ohne Verbindung öffnet die App ein gespeichertes Dokument nicht ohne Nachfrage", async () => {
  mockFiles.add(TARGET);
  mockAnswers.push(new Error("offline"));
  await expect(openDocument(DOC, "tok")).rejects.toThrow("Ohne Nachfrage beim Verein öffnet die App das Dokument nicht");
  expect(mockFiles.has(TARGET)).toBe(true);
  expect(mockLauncher.startActivityAsync).not.toHaveBeenCalled();
});

test("abgerissen: der nächste Tipp setzt mit dem Stand von Expo fort; beim Abmelden ist alles weg", async () => {
  mockAnswers.push(new Error("Netz weg"));
  mockResumeData = "4096";
  await expect(openDocument(DOC, "tok")).rejects.toThrow("der Download geht dort weiter, wo er aufgehört hat");
  mockAnswers.push({ status: 206 });
  await openDocument(DOC, "tok");
  expect(mockTasks[1].resumeData).toBe("4096");
  expect(mockTasks[1].resumed).toBe(true);
  expect(mockFiles.has(TARGET)).toBe(true);

  mockAnswers.push(new Error("Netz weg"));
  mockResumeData = "100";
  await expect(openDocument({ ...DOC, checksum: "b".repeat(64) }, "tok")).rejects.toThrow();
  await forgetDocuments();
  mockAnswers.push({ status: 200 });
  await openDocument({ ...DOC, checksum: "b".repeat(64) }, "tok");
  expect(mockTasks[mockTasks.length - 1].resumeData).toBeUndefined();
});

test("ohne Prüfsumme (eigene Dateien des Vereins) bleibt es beim bisherigen Weg", async () => {
  await openDocument({ id: "d1", mime: "application/pdf", original_filename: "Satzung.pdf" }, "tok");
  expect(mockTasks[0].uri).toBe("file:///cache/member-documents/d1-Satzung.pdf");
  expect(mockFs.getInfoAsync).not.toHaveBeenCalled();
});
