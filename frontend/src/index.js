import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { startWebClientLogging } from "@/lib/clientLog";

const root = ReactDOM.createRoot(document.getElementById("root"));
startWebClientLogging();
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
