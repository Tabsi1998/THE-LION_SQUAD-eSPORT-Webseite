import { withKeyLock } from "../lib/levelSeen";
import { getInstallationId } from "./installationId";

// Der Merker für die Frage nach Benachrichtigungen (#1208): nur auf diesem Gerät, nicht am Server, und nicht geheim -
// darum eine kleine JSON-Datei im App-Speicher (expo-file-system, schon in der App) statt des Schlüsselbunds. Darin:
// - `asked`: Die App hat Android schon einmal gefragt (Android 13 meldet vor der ersten Frage „denied“, siehe pushPrompt).
// - `migrated`: Der erste Start mit dieser Fassung ist erledigt (Bestandsgeräte, pushPrompt.notePushUpgrade).
// - `users`: je Konto die Anmeldungen, die die App schon kennt.
// Die Datei trägt die Installations-Kennung (#2470): Kommt sie über eine Android-Sicherung auf ein anderes Gerät, gilt sie
// dort nicht. Lesen oder Schreiben kann scheitern - dann gilt der Stand im Arbeitsspeicher bis zum nächsten Start, und
// ohne Datei ist die nächste Startseite nur Ausgangsstand: lieber einmal nicht fragen als bei jedem Öffnen.

export type SeenRegistrations = { seen: string[]; fresh?: boolean };
export type PushPromptState = { asked: boolean; migrated: boolean; users: Record<string, SeenRegistrations> };

const FILE_NAME = "push-prompt.json";
const LOCK = "tls.mobile.pushPromptFile";

type FileSystemLike = {
  documentDirectory: string | null;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
  getInfoAsync(uri: string): Promise<{ exists: boolean }>;
};

let fileSystemOverride: FileSystemLike | null | undefined;

function fileSystem(): FileSystemLike | null {
  if (fileSystemOverride !== undefined) return fileSystemOverride;
  try {
    // require statt import(): Metro bündelt es ohnehin, und Jest lädt es ohne VM-Module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-file-system/legacy") as FileSystemLike;
  } catch {
    return null;
  }
}

function fileUri(fs: FileSystemLike): string | null {
  return fs.documentDirectory ? `${fs.documentDirectory}${FILE_NAME}` : null;
}

export function emptyPromptState(): PushPromptState {
  return { asked: false, migrated: false, users: {} };
}

function parse(text: string, install: string | null): PushPromptState | null {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object") return null;
    if (install && raw.install && raw.install !== install) return null;
    const users: Record<string, SeenRegistrations> = {};
    for (const [id, value] of Object.entries((raw.users || {}) as Record<string, { seen?: unknown; fresh?: unknown }>)) {
      if (!Array.isArray(value?.seen)) continue;
      users[id] = { seen: value.seen.filter((key): key is string => typeof key === "string"), ...(value.fresh === true ? { fresh: true } : {}) };
    }
    return { asked: raw.asked === true, migrated: raw.migrated === true, users };
  } catch {
    return null;
  }
}

let memory: PushPromptState | null = null;

async function load(): Promise<PushPromptState> {
  if (memory) return memory;
  let state: PushPromptState | null = null;
  const fs = fileSystem();
  const uri = fs ? fileUri(fs) : null;
  if (fs && uri) {
    try {
      const info = await fs.getInfoAsync(uri);
      if (info.exists) state = parse(await fs.readAsStringAsync(uri), await getInstallationId().catch(() => null));
    } catch {
      state = null;
    }
  }
  memory = memory || state || emptyPromptState();
  return memory;
}

/** Der aktuelle Stand (aus dem Arbeitsspeicher, beim ersten Mal aus der Datei). */
export function readPromptState(): Promise<PushPromptState> {
  return withKeyLock(LOCK, load);
}

/** Ändert den Stand: erst im Arbeitsspeicher, dann in der Datei. Ein Fehler beim Schreiben bleibt still. */
export function updatePromptState(change: (state: PushPromptState) => PushPromptState): Promise<PushPromptState> {
  return withKeyLock(LOCK, async () => {
    const next = change(await load());
    memory = next;
    const fs = fileSystem();
    const uri = fs ? fileUri(fs) : null;
    if (fs && uri) {
      try {
        const install = await getInstallationId().catch(() => null);
        await fs.writeAsStringAsync(uri, JSON.stringify({ ...next, ...(install ? { install } : {}) }));
      } catch {
        // Kein Speicher: Der Stand im Arbeitsspeicher gilt bis zum nächsten Start.
      }
    }
    return next;
  });
}

/** Nur für Tests: Arbeitsspeicher vergessen und eine eigene Datei-Schicht setzen (`null`: keine). */
export function resetPromptStateForTests(fs?: FileSystemLike | null) {
  memory = null;
  fileSystemOverride = fs;
}
