import { useEffect, useState } from "react";
import { Button, Panel } from "./ui.js";
import { Icon } from "./Icons.js";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "nova.install.dismissed";

/** Offers PWA installation. Uses the browser's install prompt when available and
 *  shows manual instructions for iOS Safari, which has no programmatic prompt. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
    if (isIos) {
      setIosHint(true);
      setVisible(true);
    }

    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  return (
    <Panel className="install-prompt">
      <div className="install-prompt-body">
        <span className="install-icon" aria-hidden="true">
          <Icon name="spark" />
        </span>
        <div>
          <strong>Install NOVA GEN 5.0</strong>
          <p className="muted small">
            {iosHint
              ? "In Safari, tap Share, then “Add to Home Screen” to run NOVA full screen."
              : "Add NOVA to your home screen or desktop for a full-screen, app-like workspace."}
          </p>
        </div>
      </div>
      <div className="install-prompt-actions">
        {deferred ? (
          <Button
            type="button"
            onClick={() => {
              void deferred.prompt();
              void deferred.userChoice.finally(() => setVisible(false));
            }}
          >
            Install
          </Button>
        ) : null}
        <Button type="button" variant="quiet" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </Panel>
  );
}
