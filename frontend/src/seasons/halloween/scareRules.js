// Jumpscares (#680): die Regeln und die Varianten - reine Funktionen, damit alles testbar ist.
// Ein Schreck ist die eine bewusste Ausnahme von „dezent“, deshalb streng gerahmt: nur für Personen ab 18 (der
// Server sagt es, `scares_allowed`), nie ohne Ton, nie bei „Bewegung reduzieren“, nie in Formularen, nie neben
// laufendem Video, nie im Admin, höchstens einer je Tag und Gerät, frühestens 45 s nach dem Laden, und in den
// ersten zwei Besuchen der Saison gar nicht. Rund 130 Varianten entstehen aus Figur × Auftritt × Klang × Rahmen -
// kuratiert (die Katze fällt nicht von oben), 100 % zufällig, nie zweimal hintereinander dieselbe Figur.

export const SCARE_STORAGE = { last: "tls-scare-last", off: "tls-scare-off", visits: "tls-scare-visits" };
export const MIN_SECONDS_AFTER_LOAD = 45;
export const SKIP_FIRST_VISITS = 2;
export const MIN_DURATION_MS = 900;
export const MAX_DURATION_MS = 1800;
export const NOTE_MS = 6000;

/** Figuren mit den Auftritten und Klängen, die zu ihnen passen; `daytime`: auch bei Tag erlaubt (die milden). */
export const FIGURES = {
  spider: { entrances: ["drop", "tilt", "fade"], sounds: ["web_fly", "scare_hit"], daytime: false },
  ghost: { entrances: ["rise", "fade", "dash"], sounds: ["ghost", "whisper"], daytime: false },
  cat: { entrances: ["rise", "tilt", "dash"], sounds: ["hiss", "scare_hit"], daytime: true },
  bats: { entrances: ["dash", "rise", "fade"], sounds: ["bat_scare", "lantern"], daytime: false },
  lantern: { entrances: ["fade", "tilt"], sounds: ["lantern", "whisper"], daytime: false },
  shadow: { entrances: ["dash", "fade"], sounds: ["whisper", "scare_hit"], daytime: true },
};
export const FRAMES = ["dim", "shake", "pulse", "flicker"];

export function buildVariants() {
  const list = [];
  Object.entries(FIGURES).forEach(([figure, spec]) => {
    spec.entrances.forEach((entrance) => {
      spec.sounds.forEach((sound) => {
        FRAMES.forEach((frame) => {
          list.push({ id: `${figure}-${entrance}-${sound}-${frame}`, figure, entrance, sound, frame, daytime: spec.daytime });
        });
      });
    });
  });
  return list;
}

export const VARIANTS = buildVariants();

/** Eine Variante würfeln: nachts alle, tagsüber nur die milden, nie dieselbe Figur wie beim letzten Mal. */
export function pickVariant(rng = Math.random, { night = true, lastFigure = null } = {}) {
  const pool = VARIANTS.filter((variant) => (night || variant.daytime) && variant.figure !== lastFigure);
  const options = pool.length ? pool : VARIANTS;
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

export function scareDuration(rng = Math.random) {
  return Math.round(MIN_DURATION_MS + rng() * (MAX_DURATION_MS - MIN_DURATION_MS));
}

export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Was der Speicher über diese Person und dieses Gerät weiß. */
export function readScareState(storage, today) {
  const state = { disabled: false, lastDay: null, visits: 0 };
  try {
    state.disabled = storage?.getItem(SCARE_STORAGE.off) === "1";
    state.lastDay = storage?.getItem(SCARE_STORAGE.last) || null;
    const raw = storage?.getItem(SCARE_STORAGE.visits);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.visits = Number(parsed.count) || 0;
      state.visitedToday = parsed.day === today;
    }
  } catch {
    // ohne Speicher gilt: nie besucht, nie erschreckt
  }
  return state;
}

/** Ein Besuch je Tag zählt - erst nach zwei Besuchen darf es Schrecken geben (erst Vertrauen, dann Schreck). */
export function noteVisit(storage, today) {
  const state = readScareState(storage, today);
  if (state.visitedToday) return state.visits;
  const count = state.visits + 1;
  try {
    storage?.setItem(SCARE_STORAGE.visits, JSON.stringify({ count, day: today }));
  } catch {
    // dann eben nicht gezählt
  }
  return count;
}

export function markScared(storage, today) {
  try {
    storage?.setItem(SCARE_STORAGE.last, today);
  } catch {
    // dann kommt er morgen vielleicht noch einmal
  }
}

export function setScaresDisabled(storage, disabled) {
  try {
    if (disabled) storage?.setItem(SCARE_STORAGE.off, "1");
    else storage?.removeItem(SCARE_STORAGE.off);
  } catch {
    // ohne Speicher gilt die Sitzung
  }
}

/** Formular im Fokus oder Video/Stream läuft? Dann kein Schreck. */
export function pageState(doc = typeof document === "undefined" ? null : document) {
  if (!doc) return { inputFocused: false, mediaPlaying: false };
  const active = doc.activeElement;
  const tag = active?.tagName ? active.tagName.toLowerCase() : "";
  const inputFocused = tag === "input" || tag === "textarea" || tag === "select" || Boolean(active?.isContentEditable);
  const media = Array.from(doc.querySelectorAll("video, audio"));
  const playing = media.some((element) => !element.paused && !element.ended);
  const embeds = doc.querySelectorAll("iframe[src*='twitch'], iframe[src*='youtube'], iframe[src*='youtu.be']").length > 0;
  return { inputFocused, mediaPlaying: playing || embeds };
}

/**
 * Darf jetzt ein Schreck kommen? Liefert {ok, reason}. `env` bringt alles mit, was die Regeln brauchen - so bleibt
 * die Entscheidung ohne Browser prüfbar.
 */
export function shouldScare(env, now = Date.now()) {
  if (!env.allowed) return { ok: false, reason: "age" };
  if (env.disabled) return { ok: false, reason: "off" };
  if (env.reducedMotion) return { ok: false, reason: "motion" };
  if (!env.soundsOn) return { ok: false, reason: "mute" };
  if (env.quiet) return { ok: false, reason: "quiet" };
  if (env.inputFocused) return { ok: false, reason: "input" };
  if (env.mediaPlaying) return { ok: false, reason: "media" };
  if ((env.visits || 0) <= SKIP_FIRST_VISITS) return { ok: false, reason: "warmup" };
  if (env.lastDay && env.lastDay === env.today) return { ok: false, reason: "today" };
  if (now - (env.loadedAt || 0) < MIN_SECONDS_AFTER_LOAD * 1000) return { ok: false, reason: "early" };
  return { ok: true, reason: "go" };
}
