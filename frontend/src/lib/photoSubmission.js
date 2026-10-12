import { dayNoon, viennaDate } from "@/lib/vienna";

// Fotos vom Event einsenden (#1186): Mitglieder schicken bis eine Woche nach dem Event bis zu 20 Bilder ins Album.
// Der Server prüft alles noch einmal (Mitglied, Frist, Zahl, Bildart, Größe); hier steht nur, was die Seite vorher
// sagen kann, damit niemand 20 Bilder auswählt und erst beim Senden erfährt, dass nur 5 gehen.

export const SUBMISSION_ACCEPT = "image/png,image/jpeg,image/webp";
export const SUBMISSION_MAX_MB = 25;
const ALLOWED_TYPES = new Set(SUBMISSION_ACCEPT.split(","));

/** Die gewählten Dateien: was mitgeht und was nicht (mit Grund) - höchstens so viele, wie noch frei sind. */
export function pickSubmissionFiles(files, remaining) {
  const accepted = [];
  const skipped = [];
  const room = Math.max(0, Number(remaining) || 0);
  for (const file of Array.from(files || [])) {
    if (file.type && !ALLOWED_TYPES.has(file.type)) {
      skipped.push({ name: file.name, reason: "nur PNG, JPG oder WebP" });
    } else if (file.size > SUBMISSION_MAX_MB * 1024 * 1024) {
      skipped.push({ name: file.name, reason: `größer als ${SUBMISSION_MAX_MB} MB` });
    } else if (accepted.length >= room) {
      skipped.push({ name: file.name, reason: `höchstens ${room} ${room === 1 ? "Foto" : "Fotos"} gehen noch` });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, skipped };
}

function dayLabel(day) {
  return viennaDate(dayNoon(day), { weekday: "short", day: "numeric", month: "long" });
}

/** Eine Zeile unter dem Knopf: bis wann und wie viele noch gehen, was schon wartet. */
export function submissionHint(info) {
  if (!info) return "";
  if (!info.open) {
    return info.until ? `Einsenden war bis ${dayLabel(info.until)} möglich.` : "";
  }
  const parts = [`Bis ${dayLabel(info.until)}`];
  parts.push(info.remaining > 0 ? `noch ${info.remaining} ${info.remaining === 1 ? "Foto" : "Fotos"}` : `alle ${info.max || 20} Fotos geschickt`);
  if (info.pending) parts.push(`${info.pending} ${info.pending === 1 ? "wartet" : "warten"} auf Freigabe`);
  return parts.join(" · ");
}

/** Der Satz nach dem Senden. */
export function submissionDoneText(sent, failed) {
  if (!sent && failed) return "Das hat nicht geklappt – bitte noch einmal versuchen.";
  const head = `Danke! ${sent === 1 ? "Dein Foto wartet" : `${sent} Fotos warten`} auf Freigabe durch den Vorstand.`;
  return failed ? `${head} ${failed === 1 ? "Ein Foto ging" : `${failed} Fotos gingen`} nicht durch.` : head;
}

export function photoCredit(item) {
  return item?.credit ? `Foto: ${item.credit}` : "";
}
