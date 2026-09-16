import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { startWebClientLogging } from "@/lib/clientLog";
import { startVitals } from "@/lib/vitals";
import { toast } from "sonner";
import { applyWaitingServiceWorker, register as registerServiceWorker } from "@/serviceWorkerRegistration";

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
