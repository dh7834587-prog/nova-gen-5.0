import { useCallback, useEffect, useState } from "react";
import type {
  AuditEvent,
  OwnerOverview,
  PaymentSubmission,
  PlanId,
  PublicUser,
  SubscriptionStatus,
} from "../../shared/types.js";
import { MODULES } from "../../shared/modules.js";
import { api, errorMessage, formatDate, formatDateTime } from "../api.js";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, PanelHeader, Select, StatTile, TextArea } from "../components/ui.js";

type Tab = "users" | "payments" | "subscriptions" | "settings" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "payments", label: "Payments" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "settings", label: "Payment settings" },
  { id: "audit", label: "Audit history" },
];

export function OwnerPage() {
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<{ overview: OwnerOverview }>("/api/owner/overview");
      setOverview(payload.overview);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const patchUser = (user: PublicUser, patch: Record<string, unknown>) =>
    run(`user-${user.id}`, async () => {
      await api(`/api/owner/users/${user.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      return `${user.email} updated.`;
    });

  const patchSubscription = (userId: string, patch: Record<string, unknown>) =>
    run(`sub-${userId}`, async () => {
      await api(`/api/owner/subscriptions/${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
      return "Subscription updated.";
    });

  const review = (payment: PaymentSubmission, decision: "approve" | "reject", reviewNote: string) =>
    run(`${decision}-${payment.id}`, async () => {
      await api(`/api/owner/payments/${payment.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ reviewNote }),
      });
      return `${payment.reference} ${decision === "approve" ? "approved — the plan is now active." : "rejected."}`;
    });

  if (error && !overview) {
    return (
      <Panel>
        <PanelHeader title="Owner Control Centre" subtitle="Restricted" />
        <Notice tone="danger" title="Access denied">
          {error}
        </Notice>
      </Panel>
    );
  }

  const stats = overview?.stats;

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Owner only</span>
          <h1>Owner Control Centre</h1>
          <p>Users, plan activation, manual payment verification, feature grants and the audit trail.</p>
        </div>
      </header>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {stats ? (
        <div className="stat-grid">
          <StatTile icon="shield" label="Users" value={String(stats.users)} hint={`${stats.activeUsers} active`} />
          <StatTile icon="plans" label="Pending payments" value={String(stats.pendingPayments)} hint="Awaiting review" />
          <StatTile icon="plans" label="Active plans" value={String(stats.activeSubscriptions)} hint="Paid or trialing" />
          <StatTile icon="settings" label="Suspended" value={String(stats.suspended)} hint={`${stats.owners} owner`} />
        </div>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "users" && overview ? (
        <div className="stack">
          {overview.users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              busy={busy === `user-${user.id}`}
              onChange={(patch) => void patchUser(user, patch)}
            />
          ))}
        </div>
      ) : null}

      {tab === "payments" && overview ? (
        <div className="stack">
          {overview.payments.length === 0 ? (
            <EmptyState icon="plans" title="No payments yet" description="Manual submissions will appear here." />
          ) : (
            overview.payments.map((payment) => (
              <PaymentReview
                key={payment.id}
                payment={payment}
                busy={busy?.endsWith(payment.id) ?? false}
                onReview={(decision, reviewNote) => void review(payment, decision, reviewNote)}
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "subscriptions" && overview ? (
        <Panel>
          <PanelHeader title="Subscriptions" subtitle="Plan, status and period control" />
          <ul className="list">
            {overview.subscriptions.map((sub) => (
              <li key={sub.userId}>
                <div className="list-row list-row-static">
                  <span className="list-body">
                    <strong>{sub.email}</strong>
                    <span>
                      Trial ends {formatDate(sub.trialEndsAt)} · period ends{" "}
                      {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "—"}
                    </span>
                  </span>
                  <div className="inline-controls">
                    <Select
                      value={sub.planId}
                      aria-label={`Plan for ${sub.email}`}
                      onChange={(event) => void patchSubscription(sub.userId, { planId: event.target.value as PlanId })}
                    >
                      <option value="free">Free</option>
                      <option value="premium-monthly">Premium monthly</option>
                      <option value="premium-yearly">Premium yearly</option>
                      <option value="custom">Custom</option>
                    </Select>
                    <Select
                      value={sub.status}
                      aria-label={`Status for ${sub.email}`}
                      onChange={(event) =>
                        void patchSubscription(sub.userId, { status: event.target.value as SubscriptionStatus })
                      }
                    >
                      <option value="trialing">Trialing</option>
                      <option value="pending_approval">Pending approval</option>
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                    </Select>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tab === "settings" && overview ? (
        <PaymentSettingsForm
          initial={overview.paymentSettings}
          busy={busy === "settings"}
          onSave={(payload) =>
            run("settings", async () => {
              await api("/api/owner/payment-settings", { method: "PATCH", body: JSON.stringify(payload) });
              return "Payment settings saved.";
            })
          }
        />
      ) : null}

      {tab === "audit" && overview ? (
        <Panel>
          <PanelHeader title="Audit history" subtitle="Most recent security and billing events" />
          {overview.audit.length === 0 ? (
            <p className="muted">No events recorded yet.</p>
          ) : (
            <ul className="timeline">
              {overview.audit.map((event) => (
                <li key={event.id}>
                  <AuditRow event={event} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function UserCard({
  user,
  busy,
  onChange,
}: {
  user: PublicUser;
  busy: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const allModules = user.permissions.modules === "all";
  const granted: string[] = allModules ? MODULES.map((module) => module.id) : user.permissions.modules;
  const [open, setOpen] = useState(false);

  const toggleModule = (id: string) => {
    const next = granted.includes(id) ? granted.filter((item) => item !== id) : [...granted, id];
    onChange({ permissions: { modules: next, aiAccess: user.permissions.aiAccess } });
  };

  return (
    <Panel>
      <div className="list-row list-row-static">
        <span className="list-body">
          <strong>
            {user.name} <span className="muted">· {user.email}</span>
          </strong>
          <span>
            <Badge tone={user.role === "owner" ? "violet" : "neutral"}>{user.role}</Badge>{" "}
            <Badge tone={user.status === "active" ? "success" : "danger"}>{user.status}</Badge>{" "}
            <span className="muted small">
              joined {formatDate(user.createdAt)} · last login{" "}
              {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "never"}
            </span>
          </span>
        </span>
        <div className="inline-controls">
          <Select
            value={user.role}
            aria-label={`Role for ${user.email}`}
            disabled={busy}
            onChange={(event) => onChange({ role: event.target.value })}
          >
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </Select>
          <Select
            value={user.status}
            aria-label={`Status for ${user.email}`}
            disabled={busy}
            onChange={(event) => onChange({ status: event.target.value })}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Button variant="quiet" type="button" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide access" : "Feature access"}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="access-editor">
          <label className="check-row">
            <input
              type="checkbox"
              checked={user.permissions.aiAccess}
              onChange={(event) =>
                onChange({ permissions: { modules: user.permissions.modules, aiAccess: event.target.checked } })
              }
            />
            <span>AI access (assistant, image and video generation)</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={allModules}
              onChange={(event) =>
                onChange({
                  permissions: { modules: event.target.checked ? "all" : [], aiAccess: user.permissions.aiAccess },
                })
              }
            />
            <span>All modules</span>
          </label>
          {!allModules ? (
            <div className="module-checks">
              {MODULES.map((module) => (
                <label key={module.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={granted.includes(module.id)}
                    onChange={() => toggleModule(module.id)}
                  />
                  <span>{module.title}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function PaymentReview({
  payment,
  busy,
  onReview,
}: {
  payment: PaymentSubmission;
  busy: boolean;
  onReview: (decision: "approve" | "reject", reviewNote: string) => void;
}) {
  const [note, setNote] = useState("");
  const pending = payment.status === "pending";

  return (
    <Panel>
      <div className="list-row list-row-static">
        <span className="list-body">
          <strong>
            {payment.planName} · {payment.amountLabel} · {payment.reference}
          </strong>
          <span>
            {payment.userName} ({payment.userEmail}) · {payment.method === "afrimoney" ? "Afrimoney" : "Orange Money"}{" "}
            · sender {payment.senderName} {payment.senderPhone}
          </span>
          <span className="muted small">
            Submitted {formatDateTime(payment.submittedAt)}
            {payment.reviewedAt ? ` · reviewed ${formatDateTime(payment.reviewedAt)}` : ""}
            {payment.reviewNote ? ` · ${payment.reviewNote}` : ""}
          </span>
        </span>
        <Badge tone={payment.status === "approved" ? "success" : payment.status === "rejected" ? "danger" : "warning"}>
          {payment.status}
        </Badge>
      </div>
      {pending ? (
        <div className="review-row">
          <Field label="Review note">
            <Input value={note} placeholder="Matched against the mobile-money receipt" onChange={(event) => setNote(event.target.value)} />
          </Field>
          <Button type="button" loading={busy} onClick={() => onReview("approve", note)}>
            Approve and activate
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onReview("reject", note)}>
            Reject
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

function PaymentSettingsForm({
  initial,
  busy,
  onSave,
}: {
  initial: OwnerOverview["paymentSettings"];
  busy: boolean;
  onSave: (payload: Record<string, string>) => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <Panel>
      <PanelHeader title="Payment settings" subtitle="Shown to users on the plans page" />
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <Field label="Afrimoney number">
          <Input value={form.afrimoneyNumber} onChange={(event) => setForm({ ...form, afrimoneyNumber: event.target.value })} />
        </Field>
        <Field label="Orange Money number">
          <Input
            value={form.orangeMoneyNumber}
            onChange={(event) => setForm({ ...form, orangeMoneyNumber: event.target.value })}
          />
        </Field>
        <Field label="Account name">
          <Input value={form.accountName} onChange={(event) => setForm({ ...form, accountName: event.target.value })} />
        </Field>
        <Field label="Instructions" span>
          <TextArea
            rows={3}
            value={form.instructions}
            onChange={(event) => setForm({ ...form, instructions: event.target.value })}
          />
        </Field>
        <div className="form-actions">
          <Button type="submit" loading={busy}>
            Save payment settings
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  return (
    <div className="timeline-row">
      <span className="timeline-dot" aria-hidden="true" />
      <div>
        <strong>{event.action}</strong>
        <p>
          {event.actorEmail} · {formatDateTime(event.at)}
        </p>
        {event.detail ? <p className="muted small">{event.detail}</p> : null}
      </div>
    </div>
  );
}
