import { useEffect, useState } from "react";
import type { DashboardResponse } from "../../shared/types.js";
import { api, errorMessage, formatRelative } from "../api.js";
import { useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Icon } from "../components/Icons.js";
import { Badge, Button, EmptyState, Notice, Panel, PanelHeader, StatTile } from "../components/ui.js";
import { MODULES } from "../../shared/modules.js";

const SHORTCUTS = ["assistant", "memory", "creative", "images", "research", "code", "productivity", "plans"];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const { user, entitlement, accessibleModules } = useSession();
  const { navigate } = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DashboardResponse>("/api/dashboard")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shortcuts = MODULES.filter(
    (module) => SHORTCUTS.includes(module.id) && accessibleModules.includes(module.id),
  );

  const stats = data?.stats;

  return (
    <div className="stack">
      <section className="hero panel">
        <div className="hero-copy">
          <span className="eyebrow">NOVA GEN 5.0 · personal AI operating system</span>
          <h1>
            {greeting()}, <span className="grad-text">{user?.name?.split(" ")[0] ?? "operator"}</span>.
          </h1>
          <p>
            Your workspace is private to this account. NOVA only answers through a configured model — when no
            API key is present it says so instead of inventing a reply.
          </p>
          <div className="hero-actions">
            <Button icon="spark" onClick={() => navigate("/app/assistant")}>
              Open AI Assistant
            </Button>
            <Button variant="ghost" icon="plans" onClick={() => navigate("/app/plans")}>
              {entitlement?.status === "active" ? "Manage plan" : "View plans"}
            </Button>
          </div>
        </div>
        <div className="hero-side">
          <div className="orbit" aria-hidden="true">
            <span className="orbit-ring" />
            <span className="orbit-ring orbit-ring-2" />
            <span className="orbit-core">N</span>
          </div>
          {data ? (
            <div className="hero-status">
              <Badge tone={data.provider.configured ? "success" : "warning"}>
                {data.provider.configured ? "Model connected" : "Model not configured"}
              </Badge>
              <span>{data.provider.chatModel}</span>
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <Notice tone="danger" title="Dashboard could not load">
          {error}
        </Notice>
      ) : null}

      <div className="stat-row">
        <StatTile icon="chat" label="Conversations" value={stats?.conversations ?? 0} />
        <StatTile icon="memory" label="Memories" value={stats?.memories ?? 0} />
        <StatTile icon="productivity" label="Open tasks" value={stats?.tasksOpen ?? 0} hint={`${stats?.tasksDone ?? 0} done`} />
        <StatTile icon="files" label="Files" value={stats?.files ?? 0} />
      </div>

      <div className="split">
        <Panel>
          <PanelHeader
            title="Recent conversations"
            subtitle="Pick up where the assistant left off"
            action={
              <Button variant="quiet" onClick={() => navigate("/app/messages")}>
                View all
              </Button>
            }
          />
          {data && data.recentConversations.length > 0 ? (
            <ul className="list">
              {data.recentConversations.slice(0, 4).map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className="list-row"
                    onClick={() => navigate(`/app/assistant?c=${conversation.id}`)}
                  >
                    <span className="list-icon">
                      <Icon name="chat" size={15} />
                    </span>
                    <span className="list-body">
                      <strong>{conversation.title}</strong>
                      <span>{conversation.preview || "No messages yet"}</span>
                    </span>
                    <span className="list-meta">{formatRelative(conversation.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="chat"
              title="No conversations yet"
              description="Start a conversation and it will appear here for this account only."
              action={
                <Button variant="ghost" icon="plus" onClick={() => navigate("/app/assistant")}>
                  New conversation
                </Button>
              }
            />
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent projects"
            subtitle="Creative Studio boards"
            action={
              <Button variant="quiet" onClick={() => navigate("/app/creative")}>
                Open studio
              </Button>
            }
          />
          {data && data.recentProjects.length > 0 ? (
            <ul className="list">
              {data.recentProjects.slice(0, 4).map((project) => (
                <li key={project.id}>
                  <div className="list-row list-row-static">
                    <span className="list-icon">
                      <Icon name="palette" size={15} />
                    </span>
                    <span className="list-body">
                      <strong>{project.title}</strong>
                      <span>{project.brief || "No brief yet"}</span>
                    </span>
                    <Badge tone="violet">{project.medium}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="palette"
              title="No projects yet"
              description="Creative briefs, concepts and boards you create are listed here."
              action={
                <Button variant="ghost" icon="plus" onClick={() => navigate("/app/creative")}>
                  Create project
                </Button>
              }
            />
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Feature shortcuts" subtitle="Jump straight into a module" />
        <div className="shortcut-grid">
          {shortcuts.map((module) => (
            <button
              key={module.id}
              type="button"
              className="shortcut"
              onClick={() => navigate(module.path)}
            >
              <span className="shortcut-icon">
                <Icon name={module.icon} />
              </span>
              <span className="shortcut-text">
                <strong>{module.title}</strong>
                <span>{module.summary}</span>
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <div className="split">
        <Panel>
          <PanelHeader title="Your profile" subtitle="Private workspace identity" />
          <dl className="profile-grid">
            <div>
              <dt>Name</dt>
              <dd>{user?.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>
                <Badge tone={user?.role === "owner" ? "violet" : "neutral"}>{user?.role}</Badge>
              </dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{entitlement ? `${entitlement.planName} · ${entitlement.status.replace("_", " ")}` : "—"}</dd>
            </div>
          </dl>
          <Button variant="ghost" onClick={() => navigate("/app/settings")}>
            Account settings
          </Button>
        </Panel>

        <Panel>
          <PanelHeader title="Recent activity" subtitle="Audit events for this account" />
          {data && data.recentActivity.length > 0 ? (
            <ul className="timeline">
              {data.recentActivity.slice(0, 6).map((event) => (
                <li key={event.id}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div>
                    <strong>{event.action}</strong>
                    <span>
                      {event.detail ? `${event.detail} · ` : ""}
                      {formatRelative(event.at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No activity recorded yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
