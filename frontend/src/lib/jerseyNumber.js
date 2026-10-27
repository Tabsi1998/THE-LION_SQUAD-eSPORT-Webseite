// Wunschnummer je Mitglied (#2034): was das Eingabefeld annimmt und wie Prüfung und Anträge in einem Satz klingen.
// Die Entscheidung trifft immer der Server (Bereich, reserviert, vergeben) - hier nur, was sich ohne ihn sagen lässt.

export function parseJerseyInput(text, range) {
  const raw = String(text ?? "").trim();
  if (!raw) return { value: null, error: null };
  if (!/^\d{1,4}$/.test(raw)) return { value: null, error: "Nur Ziffern, bitte." };
  const value = Number(raw);
  if (range && (value < range.min || value > range.max)) return { value, error: `Nur Nummern von ${range.min} bis ${range.max}.` };
  return { value, error: null };
}

// Zustand der Live-Prüfung → Ton und Satz. `result` ist die Antwort von …/check, `local` der Fehler aus parseJerseyInput.
export function checkState({ input, local, result, busy, failed }) {
  if (!String(input ?? "").trim()) return { tone: "idle", text: "" };
  if (local) return { tone: "bad", text: local };
  if (busy) return { tone: "busy", text: "Prüfe …" };
  if (failed) return { tone: "bad", text: "Konnte gerade nicht prüfen – versuch es gleich noch einmal." };
  if (!result) return { tone: "busy", text: "Prüfe …" };
  if (result.free) return { tone: "ok", text: "Frei" };
  if (result.reason === "own") return { tone: "ok", text: result.text || "Das ist schon deine Nummer." };
  return { tone: "bad", text: result.text || "Vergeben" };
}

export function jerseyRequestLine(row) {
  if (!row) return "";
  const wish = row.wished === null || row.wished === undefined ? "neu wählen" : `Wunsch ${row.wished}`;
  return `Statt ${row.current}: ${wish}`;
}
