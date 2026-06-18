import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Elemento #root no encontrado en index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
