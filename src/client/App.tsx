import { useEffect, useMemo } from "react";
import { findModuleByPath, MODULES, type ModuleDefinition } from "../shared/modules.js";
import { AppShell } from "./components/AppShell.js";
import { EmptyState, Notice, Panel, Spinner } from "./components/ui.js";
import { useRouter } from "./router.js";
import { useSession } from "./session.js";
import { AssistantPage } from "./pages/Assistant.js";
import { AuthPage } from "./pages/Auth.js";
import { BrowserPage } from "./pages/Browser.js";
import { CodePage } from "./pages/Code.js";
import { CreativePage } from "./pages/Creative.js";
import { FilesPage } from "./pages/Files.js";
import { ImagePage, VideoPage } from "./pages/Generation.js";
import { HomePage } from "./pages/Home.js";
import { MemoryPage } from "./pages/Memory.js";
import { MessagesPage } from "./pages/Messages.js";
import { OwnerPage } from "./pages/Owner.js";
import { PlansPage } from "./pages/Plans.js";
import { ProductivityPage } from "./pages/Productivity.js";
import { ResearchPage } from "./pages/Research.js";
import { SettingsPage } from "./pages/Settings.js";

const ROUTES: Record<string, () => React.ReactElement> = {
  "/app/assistant": () => <AssistantPage />,
  "/app/messages": () => <MessagesPage />,
  "/app/memory": () => <MemoryPage />,
  "/app/creative": () => <CreativePage />,
  "/app/images": () => <ImagePage />,
  "/app/video": () => <VideoPage />,
  "/app/code": () => <CodePage />,
  "/app/research": () => <ResearchPage />,
  "/app/files": () => <FilesPage />,
  "/app/browser": () => <BrowserPage />,
  "/app/productivity": () => <ProductivityPage />,
  "/app/plans": () => <PlansPage />,
  "/app/settings": () => <SettingsPage />,
  "/app/owner": () => <OwnerPage />,
};

/** Modules that are always reachable once signed in, regardless of plan. */
const ALWAYS_AVAILABLE = new Set(["dashboard", "plans", "settings"]);

export default function App() {
  const { path, navigate } = useRouter();
  const { loading, user, accessibleModules } = useSession();

  const isAuthRoute = path === "/login" || path === "/register" || path === "/";
  const inApp = path === "/app" || path.startsWith("/app/");

  useEffect(() => {
    if (loading) return;
    if (!user && inApp) navigate("/login", { replace: true });
    if (user && isAuthRoute) navigate("/app", { replace: true });
    if (!user && path === "/") navigate("/login", { replace: true });
  }, [loading, user, inApp, isAuthRoute, path, navigate]);

  const module = useMemo<ModuleDefinition | undefined>(() => {
    if (path === "/app") return MODULES.find((entry) => entry.id === "dashboard");
    return findModuleByPath(path);
  }, [path]);

  if (loading) {
    return (
      <div className="boot">
        <div className="boot-inner">
          <span className="brand-mark brand-mark-lg" aria-hidden="true">
            <span className="brand-core" />
          </span>
          <strong>NOVA GEN 5.0</strong>
          <span className="muted small">Initialising your workspace…</span>
          <Spinner />
        </div>
      </div>
    );
  }

  if (isAuthRoute || !user) {
    if (path === "/register") return <AuthPage mode="register" />;
    if (user) return null;
    return <AuthPage mode="login" />;
  }

  if (!inApp || !module) {
    return (
      <div className="boot">
        <Panel>
          <EmptyState
            icon="grid"
            title="This route does not exist"
            description="The NOVA module you asked for is not registered."
            action={
              <button type="button" className="btn btn-primary" onClick={() => navigate("/app")}>
                Back to dashboard
              </button>
            }
          />
        </Panel>
      </div>
    );
  }

  const allowed = accessibleModules.includes(module.id) || ALWAYS_AVAILABLE.has(module.id);
  const ownerBlocked = module.ownerOnly && user.role !== "owner";

  if (!allowed || ownerBlocked) {
    return (
      <AppShell module={module}>
        <Panel>
          <EmptyState
            icon="shield"
            title="No access to this module"
            description={
              ownerBlocked
                ? "The Owner Control Centre is restricted to the account owner."
                : "Your current plan or permission set does not include this module. Upgrading or asking the owner to grant access unlocks it."
            }
            action={
              <button type="button" className="btn btn-primary" onClick={() => navigate("/app/plans")}>
                View plans
              </button>
            }
          />
        </Panel>
      </AppShell>
    );
  }

  const render = ROUTES[module.path];
  const page = module.id === "dashboard" ? <HomePage /> : render ? render() : null;

  return (
    <AppShell module={module}>
      {page ?? (
        <Notice tone="warning" title="Module unavailable">
          This module has no interface yet.
        </Notice>
      )}
    </AppShell>
  );
}
