import React from "react";
import ReactDOM from "react-dom/client";
import "@/fonts.css";
import "@/index.css";
import App from "@/App";
import { startWebClientLogging } from "@/lib/clientLog";
import { startVitals } from "@/lib/vitals";
import { mountStartSplash, shouldShowStartSplash } from "@/lib/startSplash";
import { toast } from "sonner";
import { applyWaitingServiceWorker, register as registerServiceWorker } from "@/serviceWorkerRegistration";
import { captureOnsiteToken } from "@/lib/onsiteToken";

// Vor-Ort-Zugang (#1592): der Code aus dem QR-Code verlässt die Adresse, bevor Statistik und Fehlerprotokoll starten.
captureOnsiteToken();

// Erster Start der installierten Website (#1324): der Löwe steht, bevor React die erste Seite zeigt.
if (shouldShowStartSplash()) mountStartSplash();
const root = ReactDOM.createRoot(document.getElementById("root"));
window.addEventListener("vite:preloadError", () => {
  toast.error("Eine neue Website-Version ist verfügbar oder die Verbindung wurde unterbrochen.", {
    id: "tls-chunk-update",
    description: "Speichere offene Eingaben, prüfe die Verbindung und lade die Seite neu.",
    duration: Infinity,
    action: { label: "Neu laden", onClick: () => window.location.reload() },
  });
});
startWebClientLogging();
startVitals();
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker({
  onUpdate: (registration) => {
    toast.info("Neue Website-Version verfügbar.", {
      id: "tls-site-update",
      description: "Speichere offene Eingaben und aktualisiere anschließend die Seite.",
      action: {
        label: "Aktualisieren",
        onClick: () => applyWaitingServiceWorker(registration),
      },
      duration: Infinity,
    });
  },
});
