import { useEffect, useId } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { AdventCalendarPanel } from "./AdventCalendarPanel";
import { OPEN_STATE_KEY, closeAdventCalendar, openAdventCalendar, useAdventCalendarOpen } from "./calendarDialog";
import "./advent-calendar.css";

// Das Fenster des Adventkalenders (#963): liegt über der Seite, auf der man gerade ist - kein Seitenwechsel. Es hängt
// an der Bühne der Saison (nur solange der Kalender läuft) und öffnet sich vom Türchen neben dem Logo, aus dem
// Handy-Menü, vom Hinweis im Dashboard und über die alte Adresse /advent, die auf die Startseite umleitet. Escape,
// der Knopf oder ein Klick daneben schließen es; am Handy füllt es den Bildschirm. Das Fenster eines Türchens liegt
// darüber (z-60 statt z-50; der Kopf der Seite liegt auf z-50).

export function AdventCalendarDialog() {
  const open = useAdventCalendarOpen();
  const location = useLocation();
  const navigate = useNavigate();
  const titleId = `advent-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // Die Umleitung von /advent legt den Wunsch in den Verlauf: einmal lesen, dann vergessen - sonst ginge das Fenster
  // bei jedem „Zurück“ wieder auf.
  useEffect(() => {
    if (!location.state?.[OPEN_STATE_KEY]) return;
    openAdventCalendar();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) closeAdventCalendar(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="tls-adv-window data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          aria-labelledby={titleId}
          aria-describedby={undefined}
          data-testid="advent-window"
        >
          <DialogPrimitive.Title className="sr-only">Adventkalender</DialogPrimitive.Title>
          <div className="tls-adv-window__scroll">
            <AdventCalendarPanel titleId={titleId} />
          </div>
          <DialogPrimitive.Close className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/70 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e9c46a]" data-testid="advent-window-close">
            <X className="h-4 w-4" />
            <span className="sr-only">Kalender schließen</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
