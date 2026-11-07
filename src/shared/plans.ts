/**
 * Plan catalogue and trial/entitlement rules.
 *
 * Prices are the published ones (Le 70 monthly, Le 840 yearly, Custom quoted).
 * Nothing here charges anybody: a manual mobile-money transfer is verified by
 * the owner before a plan becomes active.
 */
import type {
  Entitlement,
  PaymentSettings,
  PlanDefinition,
  PlanId,
  SubscriptionRecord,
} from "./types.js";

export const TRIAL_DAYS = 3;
export const MS_PER_DAY = 86_400_000;

export const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    priceLabel: "Le 0",
    cadence: "3-day trial",
    tagline: "Everything in the workspace while you evaluate NOVA.",
    features: [
      "All 15 modules unlocked",
      "3 days of AI assistant access",
      "Private per-account workspace",
      "No card and no paid service required",
    ],
    highlighted: false,
    available: true,
    purchasable: false,
  },
  {
    id: "premium-monthly",
    name: "Premium",
    priceLabel: "Le 70",
    cadence: "per month",
    tagline: "Uninterrupted AI access, renewed monthly.",
    features: [
      "Gemini chat, image and research tools",
      "Unlimited conversations and memories",
      "Manual Afrimoney / Orange Money renewal",
      "Owner-verified activation",
    ],
    highlighted: true,
    available: true,
    purchasable: true,
  },
  {
    id: "premium-yearly",
    name: "Premium Yearly",
    priceLabel: "Le 840",
    cadence: "per year",
    tagline: "Two months free compared with monthly billing.",
    features: [
      "Everything in Premium",
      "12 months of AI access",
      "Priority support from the owner",
      "One verified transfer per year",
    ],
    highlighted: false,
    available: true,
    purchasable: true,
  },
  {
    id: "custom",
    name: "Custom",
    priceLabel: "Quoted",
    cadence: "per project",
    tagline: "Individually quoted for teams and studios.",
    features: [
      "Custom module grants per member",
      "Owner-managed seats and limits",
      "Quoted after a short brief",
      "Activated after owner approval",
    ],
    highlighted: false,
    available: true,
    purchasable: false,
  },
];

export const PLAN_IDS = PLANS.map((plan) => plan.id);

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as string[]).includes(value);
}

export function findPlan(id: PlanId): PlanDefinition {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  afrimoneyNumber: "030676782",
  orangeMoneyNumber: "076278673",
  accountName: "NOVA GEN 5.0",
  instructions:
    "Send the exact plan amount with Afrimoney or Orange Money, keep the transaction id, then " +
    "submit it here. The owner verifies every transfer by hand before the plan is activated, so " +
    "activation is not instant and no payment is ever confirmed automatically.",
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
};

export function createTrialSubscription(userId: string, now: Date = new Date()): SubscriptionRecord {
  return {
    userId,
    planId: "free",
    status: "trialing",
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * MS_PER_DAY).toISOString(),
    currentPeriodEnd: null,
    customQuote: "",
    note: "Free 3-day trial created at registration.",
    updatedAt: now.toISOString(),
    updatedBy: null,
  };
}

function daysBetween(target: string, now: Date): number {
  const diff = new Date(target).getTime() - now.getTime();
  return Math.ceil(diff / MS_PER_DAY);
}

/**
 * Derives effective access from stored timestamps. Nothing is hard-coded to
 * "allowed": an expired trial really reports expired, and a plan awaiting owner
 * approval does not unlock AI by itself.
 */
export function computeEntitlement(sub: SubscriptionRecord, now: Date = new Date()): Entitlement {
  const plan = findPlan(sub.planId);
  const trialDays = daysBetween(sub.trialEndsAt, now);
  const trialActive = trialDays > 0;

  if (sub.status === "active") {
    const periodDays = sub.currentPeriodEnd ? daysBetween(sub.currentPeriodEnd, now) : 0;
    if (sub.currentPeriodEnd && periodDays <= 0) {
      return {
        planId: sub.planId,
        planName: plan.name,
        status: "expired",
        trialEndsAt: sub.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        daysRemaining: 0,
        aiAllowed: false,
        customQuote: sub.customQuote,
        reason: "Your paid period has ended. Submit a renewal payment to restore AI access.",
      };
    }
    return {
      planId: sub.planId,
      planName: plan.name,
      status: "active",
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysRemaining: Math.max(periodDays, 0),
      aiAllowed: true,
      customQuote: sub.customQuote,
      reason: null,
    };
  }

  if (sub.status === "pending_approval") {
    return {
      planId: sub.planId,
      planName: plan.name,
      status: "pending_approval",
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysRemaining: Math.max(trialDays, 0),
      aiAllowed: trialActive,
      customQuote: sub.customQuote,
      reason: trialActive
        ? "Your payment is waiting for owner verification. The trial stays active meanwhile."
        : "Your payment is waiting for owner verification. AI access resumes once it is approved.",
    };
  }

  if (sub.status === "trialing" && trialActive) {
    return {
      planId: sub.planId,
      planName: plan.name,
      status: "trialing",
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: null,
      daysRemaining: trialDays,
      aiAllowed: true,
      customQuote: sub.customQuote,
      reason: null,
    };
  }

  return {
    planId: sub.planId,
    planName: plan.name,
    status: sub.status === "cancelled" ? "cancelled" : "expired",
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    daysRemaining: 0,
    aiAllowed: false,
    customQuote: sub.customQuote,
    reason:
      sub.status === "cancelled"
        ? "This subscription was cancelled by the owner."
        : "Your 3-day trial has ended. Choose a plan and submit a manual payment to continue.",
  };
}
