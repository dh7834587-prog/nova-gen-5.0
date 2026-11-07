import { useCallback, useEffect, useState } from "react";
import type {
  CustomPlanRequest,
  PlanCatalogue,
  PaymentMethod,
  PaymentSubmission,
  PlanId,
} from "../../shared/types.js";
import { api, errorMessage, formatDate, formatDateTime } from "../api.js";
import { useSession } from "../session.js";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, PanelHeader, Select, TextArea } from "../components/ui.js";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  afrimoney: "Afrimoney",
  orange_money: "Orange Money",
};

export function PlansPage() {
  const { refresh } = useSession();
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planId, setPlanId] = useState<PlanId>("premium-monthly");
  const [method, setMethod] = useState<PaymentMethod>("afrimoney");
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requirements, setRequirements] = useState("");
  const [scale, setScale] = useState<"personal" | "team" | "business">("personal");
  const [durationPreference, setDurationPreference] = useState("");
  const [requests, setRequests] = useState<CustomPlanRequest[]>([]);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<{ catalogue: PlanCatalogue }>("/api/billing/plans");
      setCatalogue(payload.catalogue);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await api<{ message: string }>("/api/billing/payments", {
        method: "POST",
        body: JSON.stringify({
          planId,
          method,
          senderName: senderName.trim(),
          senderPhone: senderPhone.trim(),
          reference: reference.trim(),
          note: note.trim(),
        }),
      });
      setNotice(payload.message);
      setReference("");
      setNote("");
      await load();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const requestQuote = async (event: React.FormEvent) => {
    event.preventDefault();
    setQuoteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await api<{ message: string }>("/api/billing/custom-requests", {
        method: "POST",
        body: JSON.stringify({
          requirements: requirements.trim(),
          scale,
          durationPreference: durationPreference.trim(),
        }),
      });
      setNotice(payload.message);
      setRequirements("");
      setDurationPreference("");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setQuoteBusy(false);
    }
  };

  const answerQuote = async (request: CustomPlanRequest, decision: "accept" | "decline") => {
    const label =
      decision === "accept"
        ? "Accept this quotation? Your plan still activates only after the owner confirms payment."
        : "Decline this quotation? The request will be closed.";
    if (!window.confirm(label)) return;
    setRequestBusy(request.id);
    setError(null);
    try {
      const payload = await api<{ message: string }>(
        `/api/billing/custom-requests/${request.id}/${decision}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setNotice(payload.message);
      await load();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRequestBusy(null);
    }
  };

  const entitlement = catalogue?.entitlement;

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Access</span>
          <h1>Subscription Plans</h1>
          <p>
            Manual mobile-money verification. NOVA never activates a plan automatically — the owner checks the
            transfer first.
          </p>
        </div>
        <div className="page-head-action">
          <Badge tone={entitlement?.aiAllowed ? "success" : "warning"}>
            {entitlement ? `${entitlement.planName} · ${entitlement.status.replace("_", " ")}` : "Loading…"}
          </Badge>
        </div>
      </header>

      {error ? (
        <Notice tone="danger" title="Billing request failed">
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" title="Submitted for owner review">
          {notice}
        </Notice>
      ) : null}

      {entitlement ? (
        <Panel>
          <PanelHeader title="Your access" subtitle={catalogue?.notice} />
          <dl className="profile-grid">
            <div>
              <dt>Plan</dt>
              <dd>{entitlement.planName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge tone={entitlement.aiAllowed ? "success" : "warning"}>
                  {entitlement.status.replace("_", " ")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Trial ends</dt>
              <dd>{formatDate(entitlement.trialEndsAt)}</dd>
            </div>
            <div>
              <dt>Period ends</dt>
              <dd>{entitlement.currentPeriodEnd ? formatDate(entitlement.currentPeriodEnd) : "—"}</dd>
            </div>
          </dl>
          {entitlement.reason ? <Notice tone="warning">{entitlement.reason}</Notice> : null}
        </Panel>
      ) : null}

      <div className="plan-grid">
        {(catalogue?.plans ?? []).map((plan) => (
          <article key={plan.id} className={`panel plan-card ${plan.highlighted ? "is-highlighted" : ""}`}>
            <header>
              <h2>{plan.name}</h2>
              <p>{plan.tagline}</p>
            </header>
            <div className="plan-price">
              <strong>{plan.priceLabel}</strong>
              <span>{plan.cadence}</span>
            </div>
            <ul className="plan-features">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {plan.purchasable ? (
              <Button
                variant={plan.highlighted ? "primary" : "ghost"}
                onClick={() => {
                  setPlanId(plan.id);
                  document.getElementById("pay-form")?.scrollIntoView({ behavior: "smooth" });
                }}
                type="button"
              >
                Choose {plan.name}
              </Button>
            ) : (
              <p className="muted small">
                {plan.id === "custom"
                  ? "Custom plans are individually quoted — send a brief below."
                  : "Included with every new account."}
              </p>
            )}
          </article>
        ))}
      </div>

      <div className="split">
        <Panel>
          <div id="pay-form" />
          <PanelHeader title="Submit a payment" subtitle="Manual verification by the owner" />
          {catalogue ? (
            <div className="pay-instructions">
              <p>{catalogue.payments.instructions}</p>
              <dl>
                <div>
                  <dt>Afrimoney</dt>
                  <dd>{catalogue.payments.afrimoneyNumber}</dd>
                </div>
                <div>
                  <dt>Orange Money</dt>
                  <dd>{catalogue.payments.orangeMoneyNumber}</dd>
                </div>
                <div>
                  <dt>Account name</dt>
                  <dd>{catalogue.payments.accountName}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          <form className="stack-tight" onSubmit={submitPayment}>
            <div className="form-grid">
              <Field label="Plan">
                <Select value={planId} onChange={(event) => setPlanId(event.target.value as PlanId)}>
                  <option value="premium-monthly">Premium monthly · Le 70</option>
                  <option value="premium-yearly">Premium yearly · Le 840</option>
                </Select>
              </Field>
              <Field label="Method">
                <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
                  <option value="afrimoney">Afrimoney</option>
                  <option value="orange_money">Orange Money</option>
                </Select>
              </Field>
              <Field label="Name on the sending account">
                <Input value={senderName} required minLength={2} onChange={(event) => setSenderName(event.target.value)} />
              </Field>
              <Field label="Sending phone number">
                <Input value={senderPhone} required minLength={6} onChange={(event) => setSenderPhone(event.target.value)} />
              </Field>
              <Field label="Transaction reference" hint="Exactly as shown in your mobile-money receipt.">
                <Input value={reference} required minLength={4} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="Note (optional)">
                <Input value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
            </div>
            <Button type="submit" loading={submitting} icon="plans">
              Submit for verification
            </Button>
            <p className="muted small">
              Submitting does not activate anything. Your plan changes only after the owner approves the
              transfer.
            </p>
          </form>
        </Panel>

        <div className="stack">
          <Panel>
            <PanelHeader title="Custom plan brief" subtitle="Individually quoted by the owner" />
            <form className="stack-tight" onSubmit={requestQuote}>
              <Field label="What do you need?">
                <TextArea
                  rows={4}
                  value={quoteDetails}
                  required
                  minLength={10}
                  placeholder="Team seats, higher limits, a dedicated model budget…"
                  onChange={(event) => setQuoteDetails(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="ghost" loading={quoteBusy}>
                Request a quote
              </Button>
            </form>
          </Panel>

          <Panel>
            <PanelHeader title="Pending verification" subtitle="Waiting for the owner" />
            {catalogue && catalogue.pendingPayments.length > 0 ? (
              <ul className="list">
                {catalogue.pendingPayments.map((payment) => (
                  <li key={payment.id}>
                    <PaymentRow payment={payment} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No payments waiting for review.</p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Payment history" subtitle="Reviewed submissions" />
            {catalogue && catalogue.history.length > 0 ? (
              <ul className="list">
                {catalogue.history.map((payment) => (
                  <li key={payment.id}>
                    <PaymentRow payment={payment} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="plans"
                title="No reviewed payments"
                description="Approved and rejected submissions appear here with the owner's review note."
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: PaymentSubmission }) {
  return (
    <div className="list-row list-row-static">
      <span className="list-body">
        <strong>
          {payment.planName} · {payment.amountLabel}
        </strong>
        <span>
          {METHOD_LABEL[payment.method]} · ref {payment.reference} · {payment.senderName} ({payment.senderPhone})
        </span>
        <span className="muted small">
          Submitted {formatDateTime(payment.submittedAt)}
          {payment.reviewedAt ? ` · reviewed ${formatDateTime(payment.reviewedAt)}` : ""}
          {payment.reviewNote ? ` · ${payment.reviewNote}` : ""}
        </span>
      </span>
      <Badge
        tone={
          payment.status === "approved" ? "success" : payment.status === "rejected" ? "danger" : "warning"
        }
      >
        {payment.status}
      </Badge>
    </div>
  );
}
