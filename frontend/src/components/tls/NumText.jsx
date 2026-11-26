// Zahlen-Schrift im Satz (#1304): In einem Text wie „1,5 % · 9 Gruppen“, „Level 12“ oder „noch 12:30“ stehen nur die
// Zahlen in Rajdhani mit gleich breiten Ziffern (tls-type-num) - die Wörter daneben bleiben in der Schrift der Stelle.
// Zahl heißt: Ziffern mit Komma, Punkt, Doppelpunkt oder Schrägstrich dazwischen, ein Vorzeichen am Wortanfang und ein
// Prozentzeichen dahinter. Der Text bleibt Zeichen für Zeichen gleich.
const NUMBER = /((?:(?<=^|\s)[+\-−])?\d+(?:[.,:/]\d+)*(?:\s?%)?)/;

export function NumText({ text }) {
  if (text === null || text === undefined || text === "") return null;
  const parts = String(text).split(NUMBER);
  return parts.map((part, index) => (index % 2 === 1
    ? <span key={index} className="tls-type-num">{part}</span>
    : part || null));
}
