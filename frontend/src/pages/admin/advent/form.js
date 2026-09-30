// Pflege des Adventkalenders (#641): was das Formular kennt, wie aus einem gespeicherten Türchen ein Formular
// wird und aus dem Formular das, was der Server bekommt. Der Server prüft alles noch einmal - hier geht es darum,
// dass nur mitgeschickt wird, was zur gewählten Art gehört.

export const DOORS = 24;
export const KIND_HINTS = {
  text: "Ein Gruß, ein Gedicht, ein Rezept.",
  image: "Ein Foto aus dem Vereinsleben.",
  video: "Ein Video von YouTube.",
  clip: "Ein Clip von Twitch.",
  news: "Zeigt einen News-Beitrag als Karte.",
  event: "Zeigt ein Event als Karte.",
  member_spotlight: "Stellt ein Mitglied vor – nur mit Einwilligung.",
  sticker: "Ein Sticker zum Tag.",
  quiz: "Eine Frage, drei Antworten.",
  prize: "Eine Verlosung: mitmachen per Klick, Ziehung mit Protokoll.",
};
export const REF_KINDS = { news: "news", event: "events", member_spotlight: "members" };
export const REF_LABELS = { news: "News-Beitrag", event: "Event", member_spotlight: "Mitglied" };
const REF_ARTICLES = { news: "einen", event: "ein", member_spotlight: "ein" };
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const VIENNA_INPUT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function emptyForm() {
  return {
    kind: "text", title: "", body: "", media_url: "", video_url: "", clip_url: "", ref_id: "", consent_confirmed: false, sticker_id: "",
    quiz: { question: "", answers: ["", "", ""], correct: null, explanation: "" },
    prize: { label: "", value: "", winners: 1, audience: "all", closes_at: "", staff_may_enter: false },
    link_url: "", link_label: "",
  };
}

/** ISO-Zeit als Eingabewert für „datetime-local“ - in Wiener Zeit, egal wo der Rechner steht. */
export function closesInput(iso) {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return "";
  return VIENNA_INPUT.format(date).replace(" ", "T");
}

export function formFromDoor(door) {
  const form = emptyForm();
  if (!door) return form;
  const quiz = door.quiz || {};
  const prize = door.prize || {};
  return {
    ...form,
    kind: door.kind || "text",
    title: door.title || "",
    body: door.body || "",
    media_url: door.media_url || "",
    video_url: door.video_url || "",
    clip_url: door.clip_url || "",
    ref_id: door.ref_id || "",
    consent_confirmed: door.consent_confirmed === true,
    sticker_id: door.sticker?.id || "",
    quiz: {
      question: quiz.question || "",
      answers: [0, 1, 2].map((index) => (quiz.answers || [])[index] || ""),
      correct: Number.isInteger(quiz.correct) ? quiz.correct : null,
      explanation: quiz.explanation || "",
    },
    prize: {
      label: prize.prize_label || "",
      value: prize.prize_value || "",
      winners: Number(prize.winners) || 1,
      audience: prize.audience || "all",
      closes_at: closesInput(prize.closes_at),
      staff_may_enter: prize.staff_may_enter === true,
    },
    link_url: door.link_url || "",
    link_label: door.link_label || "",
  };
}

/** Was der Server bekommt: die gemeinsamen Felder und nur die der gewählten Art. */
export function payloadFromForm(form) {
  const kind = form.kind;
  const payload = { kind, title: form.title.trim(), body: form.body.trim() };
  if (form.media_url && kind !== "sticker") payload.media_url = form.media_url;
  if (form.link_url.trim()) {
    payload.link_url = form.link_url.trim();
    if (form.link_label.trim()) payload.link_label = form.link_label.trim();
  }
  if (kind === "video") payload.video_url = form.video_url.trim();
  if (kind === "clip") payload.clip_url = form.clip_url.trim();
  if (REF_KINDS[kind]) payload.ref_id = form.ref_id;
  if (kind === "member_spotlight") payload.consent_confirmed = form.consent_confirmed === true;
  if (kind === "sticker") payload.sticker_id = form.sticker_id;
  if (kind === "quiz") {
    payload.quiz = { question: form.quiz.question.trim(), answers: form.quiz.answers.map((answer) => answer.trim()), correct: form.quiz.correct, explanation: form.quiz.explanation.trim() };
  }
  if (kind === "prize") {
    payload.prize = {
      label: form.prize.label.trim(), value: form.prize.value.trim(), winners: Math.round(Number(form.prize.winners)) || 1,
      audience: form.prize.audience, staff_may_enter: form.prize.staff_may_enter === true,
      ...(form.prize.closes_at ? { closes_at: form.prize.closes_at } : {}),
    };
  }
  return payload;
}

/** Was vor dem Speichern noch fehlt - der erste Satz, der zutrifft (der Server prüft genauso). */
export function missing(form) {
  if (!form.title.trim()) return "Das Türchen braucht einen Titel.";
  if (form.kind === "text" && !form.body.trim()) return "Ein Text-Türchen braucht einen Text.";
  if (form.kind === "image" && !form.media_url) return "Ein Bild-Türchen braucht ein Bild.";
  if (form.kind === "video" && !form.video_url.trim()) return "Bitte die Adresse des Videos eintragen.";
  if (form.kind === "clip" && !form.clip_url.trim()) return "Bitte die Adresse des Clips eintragen.";
  if (REF_KINDS[form.kind] && !form.ref_id) return `Bitte ${REF_ARTICLES[form.kind]} ${REF_LABELS[form.kind]} auswählen.`;
  if (form.kind === "member_spotlight" && !form.consent_confirmed) return "Bitte bestätigen, dass das Mitglied einverstanden ist.";
  if (form.kind === "sticker" && !form.sticker_id) return "Bitte einen Sticker auswählen.";
  if (form.kind === "quiz") {
    if (!form.quiz.question.trim()) return "Das Quiz braucht eine Frage.";
    if (form.quiz.answers.some((answer) => !answer.trim())) return "Das Quiz braucht drei Antworten.";
    if (![0, 1, 2].includes(form.quiz.correct)) return "Bitte die richtige Antwort markieren.";
  }
  if (form.kind === "prize" && !form.prize.label.trim()) return "Der Gewinn braucht einen Namen.";
  return "";
}

/** Das Jahr, das gerade gepflegt wird: im Jänner noch der Kalender vom Dezember davor. */
export function defaultYear(now = new Date()) {
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}

/** Die Jahre zur Auswahl: alle mit Türchen, dazu das laufende und das nächste - das neueste zuerst. */
export function yearOptions(years, now = new Date()) {
  const current = defaultYear(now);
  return [...new Set([...(years || []).map(Number).filter(Boolean), current, current + 1])].sort((a, b) => b - a);
}

/** „Di, 1. Dezember“ */
export function dayText(year, day) {
  return `${WEEKDAYS[new Date(Date.UTC(year, 11, day)).getUTCDay()]}, ${day}. Dezember`;
}

/** Die Zeitpunkte für die Vorschau: jeder Tag um 9 Uhr und die Nachholzeit. */
export function previewMoments(year) {
  const pad = (value) => String(value).padStart(2, "0");
  const days = Array.from({ length: DOORS }, (_, index) => ({ key: `${year}-12-${pad(index + 1)}T09:00:00`, label: `${dayText(year, index + 1)} – Türchen ${index + 1} ist das neueste` }));
  return [...days, { key: `${year}-12-27T09:00:00`, label: "Nachholzeit – alle Türchen sind offen" }];
}

/** Der Zeitpunkt, mit dem die Vorschau beginnt: heute, wenn der Kalender läuft - sonst der Heilige Abend. */
export function defaultMoment(year, now = new Date()) {
  const moments = previewMoments(year);
  const running = now.getFullYear() === year && now.getMonth() === 11 && now.getDate() <= DOORS;
  return running ? moments[now.getDate() - 1].key : moments[DOORS - 1].key;
}

const PICKUP = { pending: "vorgemerkt", ready: "abholbereit", picked_up: "übergeben", expired: "verfallen" };

export function pickupLabel(status) {
  return PICKUP[status] || "offen";
}

const STAMP = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** „13.12.2026, 20:05 Uhr“ in Wiener Zeit. */
export function stampText(iso) {
  const date = new Date(iso || "");
  return Number.isNaN(date.getTime()) ? "" : `${STAMP.format(date)} Uhr`;
}

/** Der Inhalt, wie ihn das Fenster zeigt - aus dem Formular gebaut, damit die Vorschau ohne Speichern auskommt. */
export function previewContent(form, options = {}, day = 1) {
  const content = { kind: form.kind, title: form.title.trim() || `Türchen ${day}`, body: form.body.trim(), media_url: form.kind === "sticker" ? null : form.media_url || null, link: form.link_url.trim() ? { url: form.link_url.trim(), label: form.link_label.trim() || "Mehr dazu" } : null };
  if (form.kind === "video") content.video = { url: form.video_url.trim() };
  if (form.kind === "clip") {
    const match = form.clip_url.trim().match(/(?:clips\.twitch\.tv\/|\/clip\/)([A-Za-z0-9_-]{4,120})/);
    content.clip = match ? { id: match[1], url: `https://clips.twitch.tv/${match[1]}` } : null;
  }
  if (REF_KINDS[form.kind]) {
    const picked = (options[REF_KINDS[form.kind]] || []).find((row) => row.id === form.ref_id);
    if (picked && (form.kind !== "member_spotlight" || form.consent_confirmed)) {
      content.card = form.kind === "member_spotlight" ? { name: picked.label, role: picked.hint, image_url: null, url: null } : { title: picked.label, excerpt: "", image_url: null, url: null, date: null };
    } else {
      content.kind = "text";
    }
  }
  if (form.kind === "sticker") {
    const sticker = (options.stickers || []).flatMap((pack) => pack.stickers).find((row) => row.id === form.sticker_id);
    content.sticker = sticker || null;
  }
  if (form.kind === "quiz") content.quiz = { question: form.quiz.question.trim(), answers: form.quiz.answers.map((answer) => answer.trim()), done: false };
  if (form.kind === "prize") {
    const winners = Math.round(Number(form.prize.winners)) || 1;
    content.prize = { label: form.prize.label.trim() || "Gewinn", value: form.prize.value.trim(), winners, audience: form.prize.audience, closes_at: form.prize.closes_at || null, status: "open", entries: 0, entered: false, can_enter: true, can_withdraw: false, won: false, hint: null, terms: [] };
  }
  return content;
}
