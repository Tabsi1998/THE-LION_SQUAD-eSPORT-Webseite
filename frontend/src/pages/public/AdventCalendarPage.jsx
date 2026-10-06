import { Navigate } from "react-router-dom";
import { OPEN_STATE_KEY } from "@/advent/calendarDialog";

// /advent war die Seite des Adventkalenders (#641). Seit #963 ist der Kalender ein Fenster über der Startseite - das
// Türchen neben dem Logo öffnet es. Die Adresse bleibt für alte Links, Benachrichtigungen und Lesezeichen: sie führt
// auf die Startseite und lässt dort das Fenster aufgehen, solange der Kalender läuft.

export default function AdventCalendarPage() {
  return <Navigate to="/" replace state={{ [OPEN_STATE_KEY]: true }} />;
}
