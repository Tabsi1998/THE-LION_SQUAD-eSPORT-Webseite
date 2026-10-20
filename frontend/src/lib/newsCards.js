// Kleine Regeln für News-Karten (#1343): der Satz auf der Text-Karte und keine zwei gleichen Bilder nebeneinander.

export const TEXT_CARD_MAX_CHARS = 120;

// Tags weg, bis keine mehr übrig sind (wie NewsDetailPage, #1408) - React gibt den Text ohnehin nur als Text aus.
function clean(value) {
  let text = String(value || "");
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]+>/g, " ");
  } while (text !== previous);
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Der erste Satz des Anrisses (sonst der Titel), höchstens `max` Zeichen - gekürzt am Wortende mit „…“. */
export function textCardSentence(news, max = TEXT_CARD_MAX_CHARS) {
  const source = clean(news?.excerpt) || clean(news?.title);
  if (!source) return "";
  const end = source.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? source.slice(0, end + 1) : source;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** Steht dasselbe Bild schon weiter vorne, bekommt die Karte die Text-Karte statt einer Wiederholung. */
export function withoutRepeatedBanners(items = []) {
  const seen = new Set();
  return items.map((item) => {
    const url = item?.banner_url;
    if (!url) return item;
    if (seen.has(url)) return { ...item, banner_url: null };
    seen.add(url);
    return item;
  });
}
