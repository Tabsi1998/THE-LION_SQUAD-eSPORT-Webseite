import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { startWebClientLogging } from "@/lib/clientLog";
import { toast } from "sonner";
import { applyWaitingServiceWorker, register as registerServiceWorker } from "@/serviceWorkerRegistration";

const root = ReactDOM.createRoot(document.getElementById("root"));
startWebClientLogging();
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker({
  onUpdate: (registration) => {
    toast.info("Neue Website-Version verfügbar.", {
      description: "Aktualisieren lädt die neue Version sofort.",
      action: {
        label: "Aktualisieren",
        onClick: () => applyWaitingServiceWorker(registration),
      },
      duration: 12000,
    });
  },
});
