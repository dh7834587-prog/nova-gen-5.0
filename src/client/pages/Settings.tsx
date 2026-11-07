import { useCallback, useEffect, useState } from "react";
import type { PublicUser } from "../../shared/types.js";
import { api, errorMessage, formatDateTime } from "../api.js";
import { useSession } from "../session.js";
import { Badge, Button, Field, Input, Notice, Panel, PanelHeader, Select } from "../components/ui.js";

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
  current: boolean;
}

export function SettingsPage() {
  const { user, entitlement, setUser, logout } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const payload = await api<{ sessions: SessionRow[] }>("/api/account/sessions");
      setSessions(payload.sessions);
      setSessionError(null);
    } catch (cause) {
      setSessionError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("profile");
    setProfileError(null);
    setProfileMessage(null);
    try {
      const payload = await api<{ user: PublicUser }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setUser(payload.user);
      setProfileMessage("Profile updated.");
    } catch (cause) {
      setProfileError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const savePreferences = async (patch: Record<string, unknown>) => {
    try {
      const payload = await api<{ user: PublicUser }>("/api/account/preferences", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setUser(payload.user);
    } catch (cause) {
      setProfileError(errorMessage(cause));
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("password");
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      const payload = await api<{ message: string }>("/api/account/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordMessage(payload.message);
      setCurrentPassword("");
      setNewPassword("");
    } catch (cause) {
      setPasswordError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api(`/api/account/sessions/${id}`, { method: "DELETE" });
      await loadSessions();
    } catch (cause) {
      setSessionError(errorMessage(cause));
    }
  };

  const revokeAll = async () => {
    try {
      await api("/api/account/sessions", { method: "DELETE" });
      await logout();
    } catch (cause) {
      setSessionError(errorMessage(cause));
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Account</span>
          <h1>Settings</h1>
          <p>Profile, security, appearance and session control for your private workspace.</p>
        </div>
      </header>

      <div className="split">
        <Panel>
          <PanelHeader title="Profile" subtitle="How NOVA addresses you" />
          <form className="stack-tight" onSubmit={saveProfile}>
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required />
            </Field>
            <Field label="Email" hint="Email changes require owner verification in this prototype.">
              <Input value={user?.email ?? ""} readOnly disabled />
            </Field>
            {profileError ? <Notice tone="danger">{profileError}</Notice> : null}
            {profileMessage ? <Notice tone="success">{profileMessage}</Notice> : null}
            <Button type="submit" loading={busy === "profile"}>
              Save profile
            </Button>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="Security" subtitle="Password and active sessions" />
          <form className="stack-tight" onSubmit={changePassword}>
            <Field label="Current password">
              <Input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field label="New password" hint="At least 10 characters with a letter and a number.">
              <Input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                required
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            {passwordError ? <Notice tone="danger">{passwordError}</Notice> : null}
            {passwordMessage ? <Notice tone="success">{passwordMessage}</Notice> : null}
            <Button type="submit" loading={busy === "password"} disabled={!newPassword}>
              Update password
            </Button>
          </form>
        </Panel>
      </div>

      <div className="split">
        <Panel>
          <PanelHeader title="Appearance" subtitle="Accent and navigation density" />
          <div className="form-grid">
            <Field label="Accent">
              <Select
                value={user?.preferences.accent ?? "violet"}
                onChange={(event) => void savePreferences({ accent: event.target.value })}
              >
                <option value="violet">Violet</option>
                <option value="purple">Purple</option>
                <option value="indigo">Indigo</option>
              </Select>
            </Field>
            <Field label="Compact navigation">
              <Select
                value={user?.preferences.compactNav ? "on" : "off"}
                onChange={(event) => void savePreferences({ compactNav: event.target.value === "on" })}
              >
                <option value="off">Comfortable</option>
                <option value="on">Compact</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Plan and access" subtitle="Effective entitlement right now" />
          <dl className="profile-grid">
            <div>
              <dt>Plan</dt>
              <dd>{entitlement?.planName ?? "—"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge tone={entitlement?.aiAllowed ? "success" : "warning"}>
                  {entitlement?.status.replace("_", " ") ?? "—"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>AI access</dt>
              <dd>{entitlement?.aiAllowed ? "Enabled" : "Locked"}</dd>
            </div>
            <div>
              <dt>Trial ends</dt>
              <dd>{formatDateTime(entitlement?.trialEndsAt)}</dd>
            </div>
          </dl>
          {entitlement?.reason ? <Notice tone="warning">{entitlement.reason}</Notice> : null}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Active sessions"
          subtitle="Every device holding a valid session for this account"
          action={
            <Button variant="ghost" onClick={() => void revokeAll()} type="button">
              Sign out everywhere
            </Button>
          }
        />
        {sessionError ? <Notice tone="danger">{sessionError}</Notice> : null}
        {sessions.length === 0 ? (
          <p className="muted">No sessions listed.</p>
        ) : (
          <ul className="list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div className="list-row list-row-static">
                  <span className="list-body">
                    <strong>
                      {session.userAgent.slice(0, 60) || "Unknown device"}{" "}
                      {session.current ? <Badge tone="violet">This device</Badge> : null}
                    </strong>
                    <span>
                      Started {formatDateTime(session.createdAt)} · expires {formatDateTime(session.expiresAt)}
                    </span>
                  </span>
                  <Button
                    variant="quiet"
                    type="button"
                    onClick={() => void revoke(session.id)}
                    disabled={session.current}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
