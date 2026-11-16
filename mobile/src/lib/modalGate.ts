import { useEffect } from "react";

// Nie zwei Fenster übereinander (#1208): Blätter und Dialoge, die von selbst erscheinen (Abstimmung, Belohnung,
// Erfolgs-Zeremonie, Passkey-Einladung, „Spielst du auch mit?“), melden sich hier, solange sie offen sind. Wer selbst nur
// ein Angebot ist - die Frage nach Benachrichtigungen -, wartet mit `whenNoModalOpen`, bis keins mehr offen ist.

const open = new Set<string>();
const waiters = new Set<() => void>();

export function setModalOpen(id: string, isOpen: boolean) {
  if (isOpen) open.add(id);
  else open.delete(id);
  if (!open.size) {
    const ready = [...waiters];
    waiters.clear();
    ready.forEach((resolve) => resolve());
  }
}

export function anyModalOpen(): boolean {
  return open.size > 0;
}

/** Erfüllt sich, sobald kein gemeldetes Fenster offen ist (sofort, wenn keins offen ist). */
export function whenNoModalOpen(): Promise<void> {
  if (!open.size) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.add(resolve);
  });
}

/** Ein Fenster meldet sich: solange `isOpen`, wartet die Frage nach Benachrichtigungen. */
export function useModalGate(id: string, isOpen: boolean) {
  useEffect(() => {
    setModalOpen(id, isOpen);
    return () => setModalOpen(id, false);
  }, [id, isOpen]);
}
