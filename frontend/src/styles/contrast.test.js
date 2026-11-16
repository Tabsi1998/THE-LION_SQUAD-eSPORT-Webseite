import { readFileSync } from "node:fs";
import path from "node:path";

// Kontrast-Wächter (#2412, F18 aus dem Audit vom 06.10.): Weiß mit wenig Deckkraft liegt auf unserem Grund (#0A0A0A bis
// #1F1F24) unter WCAG AA - white/40 hat 3,8 : 1, white/25 nur 2,1 : 1, nötig sind 4,5 : 1 für Text und 3 : 1 für
// Bedienelemente. Leiser Text nimmt die Rolle text-quiet (6,1 : 1) oder text-muted-text (9,6 : 1). Die Liste wächst mit
// jeder Fläche, die umgestellt ist.
const CHECKED = [
  "components/tls/AdminLayout.jsx",
  "components/tls/BottomNav.jsx",
  "components/tls/NotificationRow.jsx",
];

// text-white/5 … text-white/44 (auch hinter hover:, placeholder: usw.) - ab 45 % reicht es auf dem dunkelsten Grund knapp.
const TOO_FAINT = /(?:^|[\s"'`:])(?:placeholder:)?text-white\/(?:[1-9]|[1-3]\d|4[0-4])(?![\d])/g;

test.each(CHECKED)("%s: kein Text unter WCAG AA (white/5 bis white/44)", (file) => {
  const text = readFileSync(path.join(process.cwd(), "src", file), "utf8");
  const found = (text.match(TOO_FAINT) || []).map((hit) => hit.trim());
  expect(found).toEqual([]);
});
