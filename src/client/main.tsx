import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { RouterProvider } from "./router.js";
import { SessionProvider } from "./session.js";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container missing");

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);

/* PWA: the service worker only caches the app shell; /api traffic always goes to the network. */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* Installability is an enhancement; the app still works without it. */
    });
  });
}
