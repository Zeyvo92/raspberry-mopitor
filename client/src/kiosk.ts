import { useCallback, useEffect, useState } from "react";

/**
 * Kiosk mode: a Pi driving a small screen in a rack shows the dashboard and
 * nothing else — no tabs, no controls, no cursor, fullscreen where the
 * browser allows it. `?kiosk=1` starts that way, Escape leaves.
 */
function initialKiosk(): boolean {
  return new URLSearchParams(window.location.search).get("kiosk") === "1";
}

export interface KioskApi {
  kiosk: boolean;
  setKiosk: (on: boolean) => void;
  toggleKiosk: () => void;
}

export function useKiosk(): KioskApi {
  const [kiosk, setKiosk] = useState(initialKiosk);

  useEffect(() => {
    document.documentElement.dataset.kiosk = kiosk ? "true" : "false";

    const element = document.documentElement;
    if (kiosk) {
      // browsers only grant this during a user gesture: entering from the URL
      // simply stays windowed, which is fine
      void element.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, [kiosk]);

  useEffect(() => {
    if (!kiosk) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setKiosk(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [kiosk]);

  const toggleKiosk = useCallback(() => setKiosk((on) => !on), []);

  return { kiosk, setKiosk, toggleKiosk };
}
