import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MODULES, type ModuleDefinition, type ModuleGroup } from "../../shared/modules.js";
import { formatDate } from "../api.js";
import { useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Icon } from "./Icons.js";
import { Badge, Button } from "./ui.js";

const GROUPS: ModuleGroup[] = ["Core", "Create", "Work", "Account"];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <span className="brand-core" />
      </span>
      <span className="brand-text">
        <strong>NOVA</strong>
        <span>GEN 5.0</span>
      </span>
    </div>
  );
}

function planLabel(status: string, planName: string): { text: string; tone: "violet" | "success" | "warning" | "neutral" } {
  if (status === "active") return { text: planName, tone: "success" };
  if (status === "trialing") return { text: "Trial", tone: "violet" };
  if (status === "pending_approval") return { text: "Payment pending", tone: "warning" };
  return { text: planName, tone: "neutral" };
}

export function AppShell({ module, children }: { module: ModuleDefinition; children: ReactNode }) {
  const { path, navigate } = useRouter();
  const { user, entitlement, accessibleModules, logout } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [path]);

  useEffect(() => {
    document.body.classList.toggle("no-scroll", drawerOpen);
    return () => document.body.classList.remove("no-scroll");
  }, [drawerOpen]);

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        modules: MODULES.filter(
          (entry) =>
            entry.group === group &&
            accessibleModules.includes(entry.id) &&
            (!entry.ownerOnly || user?.role === "owner"),
        ),
      })).filter((entry) => entry.modules.length > 0),
    [accessibleModules, user?.role],
  );

  const initials = (user?.name ?? "NOVA")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const badge = entitlement ? planLabel(entitlement.status, entitlement.planName) : null;

  const nav = (
    <nav className="nav" aria-label="NOVA modules">
      {groups.map(({ group, modules }) => (
        <div key={group} className="nav-group">
          <span className="nav-group-label">{group}</span>
          {modules.map((entry) => {
            const active = path === entry.path;
            return (
              <button
                key={entry.id}
                type="button"
                className={`nav-item ${active ? "is-active" : ""}`}
                onClick={() => navigate(entry.path)}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={entry.icon} size={17} />
                <span>{entry.title}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="shell">
      <div className="aurora" aria-hidden="true">
        <span className="aurora-blob aurora-a" />
        <span className="aurora-blob aurora-b" />
        <span className="aurora-blob aurora-c" />
      </div>

      <aside className={`sidebar ${drawerOpen ? "is-open" : ""}`} id="nova-sidebar">
        <div className="sidebar-top">
          <button type="button" className="brand-button" onClick={() => navigate("/app")} aria-label="NOVA home">
            <Brand />
          </button>
          <button
            type="button"
            className="icon-button sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" />
          </button>
        </div>
        {nav}
        <div className="sidebar-foot">
          <button type="button" className="user-chip" onClick={() => navigate("/app/settings")}>
            <span className="avatar">{initials}</span>
            <span className="user-meta">
              <strong>{user?.name ?? "Guest"}</strong>
              <span>{user?.email ?? "Not signed in"}</span>
            </span>
          </button>
          <Button variant="quiet" icon="logout" onClick={() => void logout()} type="button">
            Sign out
          </Button>
        </div>
      </aside>

      {drawerOpen ? (
        <button
          type="button"
          className="scrim"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation overlay"
        />
      ) : null}

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-controls="nova-sidebar"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-title">
            <span className="topbar-eyebrow">NOVA GEN 5.0</span>
            <strong>{module.title}</strong>
          </div>
          <div className="topbar-right">
            {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
            {entitlement?.status === "trialing" ? (
              <span className="topbar-note">
                {entitlement.daysRemaining > 0
                  ? `Trial ends ${formatDate(entitlement.trialEndsAt)}`
                  : "Trial ended"}
              </span>
            ) : null}
            <button
              type="button"
              className="avatar avatar-button"
              onClick={() => navigate("/app/settings")}
              aria-label="Open account settings"
            >
              {initials}
            </button>
          </div>
        </header>
        <main className="content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
