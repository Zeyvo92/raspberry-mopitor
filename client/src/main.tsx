import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { DisplayProvider } from "./settings";
import { ThemeProvider } from "./theme";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <DisplayProvider>
          <App />
        </DisplayProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);

// Installable, and able to render itself when the Pi is unreachable. Only in
// a build: in dev the worker would cache what Vite is busy hot-reloading.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // http on a non-localhost origin, or the browser said no — the app
      // works exactly the same, it just isn't installable
    });
  });
}
