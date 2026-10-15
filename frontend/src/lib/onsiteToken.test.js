import { captureOnsiteToken, forgetOnsiteToken, peekOnsiteToken } from "@/lib/onsiteToken";

// Wie im Browser: `location` ist lebendig - nach replaceState ist der Anker weg.
function fakeWindow(pathname, hash) {
  const calls = [];
  const location = { pathname, hash };
  return {
    location,
    history: {
      state: { idx: 1 },
      replaceState: (...args) => {
        calls.push(args);
        location.hash = "";
      },
    },
    calls,
  };
}

test("nimmt den Code aus /vor-ort#… und bereinigt die Adresse sofort", () => {
  const code = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_";
  const { location, history, calls } = fakeWindow("/vor-ort", `#${code}`);
  expect(captureOnsiteToken(location, history)).toBe(true);
  expect(calls).toEqual([[{ idx: 1 }, "", "/vor-ort"]]);
  expect(peekOnsiteToken()).toBe(code);
  // Nach dem Einlösen vergessen: Neuladen heißt neu scannen.
  forgetOnsiteToken();
  expect(peekOnsiteToken()).toBe("");
});

test("lässt andere Seiten und Anker in Ruhe", () => {
  const { location, history, calls } = fakeWindow("/about", "#werte");
  expect(captureOnsiteToken(location, history)).toBe(false);
  expect(calls).toEqual([]);
  expect(peekOnsiteToken()).toBe("");
});

test("ein kaputter Code wird trotzdem aus der Adresse entfernt, aber nicht eingelöst", () => {
  const { location, history, calls } = fakeWindow("/vor-ort/", "#<script>");
  expect(captureOnsiteToken(location, history)).toBe(false);
  expect(calls).toHaveLength(1);
  expect(peekOnsiteToken()).toBe("");
});

test("ein Code mit kaputter Kodierung bricht den Start nicht ab", () => {
  const { location, history, calls } = fakeWindow("/vor-ort", "#%E0%A4%A");
  expect(captureOnsiteToken(location, history)).toBe(false);
  expect(calls).toHaveLength(1);
});
