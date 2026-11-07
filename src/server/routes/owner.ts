import { Router } from "express";
import { z } from "zod";
import { MODULE_IDS } from "../../shared/modules.js";
import { MS_PER_DAY, computeEntitlement, createTrialSubscription, findPlan } from "../../shared/plans.js";
import type {
  OwnerOverview,
  PlanId,
  SubscriptionStatus,
  UserPermissions,
} from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save, toPublicUser } from "../http.js";
import { nowIso, type Database } from "../store.js";

const moduleGrantSchema = z.union([
  z.literal("all"),
  z.array(z.string().trim().min(1).max(40)).max(MODULE_IDS.length + 4),
]);

const userPatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(["owner", "member"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  permissions: z
    .object({
      modules: moduleGrantSchema,
      aiAccess: z.boolean(),
    })
    .optional(),
});

const subscriptionPatchSchema = z.object({
  planId: z.enum(["free", "premium-monthly", "premium-yearly", "custom"]).optional(),
  status: z.enum(["trialing", "pending_approval", "active", "expired", "cancelled"]).optional(),
  currentPeriodEnd: z.string().trim().max(40).nullable().optional(),
  customQuote: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(400).optional(),
});

const settingsSchema = z.object({
  afrimoneyNumber: z.string().trim().min(6).max(24),
  orangeMoneyNumber: z.string().trim().min(6).max(24),
  accountName: z.string().trim().min(2).max(80),
  instructions: z.string().trim().min(10).max(800),
});

const reviewSchema = z.object({ reviewNote: z.string().trim().max(400).default("") });

function planDurationDays(planId: PlanId): number {
  if (planId === "premium-yearly") return 365;
  if (planId === "custom") return 30;
  return 30;
}

function sanitisePermissions(input: { modules: string[] | "all"; aiAccess: boolean }): UserPermissions {
  if (input.modules === "all") return { modules: "all", aiAccess: input.aiAccess };
  const known = new Set(MODULE_IDS);
  const filtered = [...new Set(input.modules.filter((id) => known.has(id)))];
  return { modules: filtered, aiAccess: input.aiAccess };
}

function countOwners(db: Database): number {
  let total = 0;
  for (const user of db.users.values()) if (user.role === "owner") total += 1;
  return total;
}

/**
 * Owner-only workspace administration: users, permissions, subscriptions,
 * manual payment approval, receiving numbers and the audit trail.
 */
export function ownerRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireOwner);

  router.get("/overview", (_req, res) => {
    const users = [...db.users.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const payments = [...db.payments.values()].sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt),
    );

    const subscriptions = users.map((user) => {
      const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
      db.subscriptions.set(user.id, subscription);
      return {
        userId: user.id,
        email: user.email,
        planId: subscription.planId,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
      };
    });

    const overview: OwnerOverview = {
      users: users.map(toPublicUser),
      subscriptions,
      payments,
      audit: db.audit.slice(0, 60),
      paymentSettings: db.settings,
      stats: {
        users: users.length,
        activeUsers: users.filter((user) => user.status === "active").length,
        owners: users.filter((user) => user.role === "owner").length,
        suspended: users.filter((user) => user.status === "suspended").length,
        pendingPayments: payments.filter((payment) => payment.status === "pending").length,
        activeSubscriptions: subscriptions.filter((row) => row.status === "active").length,
      },
    };
    res.json({ overview });
  });

  router.patch(
    "/users/:id",
    asyncHandler(async (req, res) => {
      const actor = currentUser(res);
      const target = db.users.get(String(req.params.id));
      if (!target) throw new HttpError(404, "not_found", "That user does not exist.");
      const input = parseBody(userPatchSchema, req.body);

      if (target.id === actor.id) {
        if (input.role === "member") {
          throw new HttpError(409, "self_demotion", "You cannot remove your own owner role.");
        }
        if (input.status === "suspended") {
          throw new HttpError(409, "self_suspend", "You cannot suspend your own account.");
        }
      }
      if (target.role === "owner" && input.role === "member" && countOwners(db) <= 1) {
        throw new HttpError(409, "last_owner", "At least one owner must remain.");
      }

      if (input.name !== undefined) target.name = input.name;
      if (input.role !== undefined) target.role = input.role;
      if (input.status !== undefined) target.status = input.status;
      if (input.permissions !== undefined) target.permissions = sanitisePermissions(input.permissions);

      log(
        db,
        actor,
        "owner.user_updated",
        `${target.email}: role=${target.role} status=${target.status} modules=${
          target.permissions.modules === "all" ? "all" : target.permissions.modules.join(",") || "none"
        }`,
      );
      save(db);
      res.json({ user: toPublicUser(target) });
    }),
  );

  router.patch(
    "/subscriptions/:userId",
    asyncHandler(async (req, res) => {
      const actor = currentUser(res);
      const target = db.users.get(String(req.params.userId));
      if (!target) throw new HttpError(404, "not_found", "That user does not exist.");
      const input = parseBody(subscriptionPatchSchema, req.body);

      const subscription = db.subscriptions.get(target.id) ?? createTrialSubscription(target.id);
      db.subscriptions.set(target.id, subscription);

      if (input.planId !== undefined) subscription.planId = input.planId;
      if (input.status !== undefined) subscription.status = input.status as SubscriptionStatus;
      if (input.customQuote !== undefined) subscription.customQuote = input.customQuote;
      if (input.note !== undefined) subscription.note = input.note;

      if (input.currentPeriodEnd !== undefined) {
        subscription.currentPeriodEnd = input.currentPeriodEnd || null;
      } else if (input.status === "active") {
        subscription.currentPeriodEnd = new Date(
          Date.now() + planDurationDays(subscription.planId) * MS_PER_DAY,
        ).toISOString();
      }

      subscription.updatedAt = nowIso();
      subscription.updatedBy = actor.id;

      log(
        db,
        actor,
        "owner.subscription_updated",
        `${target.email}: ${subscription.planId}/${subscription.status}`,
      );
      save(db);
      res.json({
        subscription,
        entitlement: computeEntitlement(subscription),
        planName: findPlan(subscription.planId).name,
      });
    }),
  );

  router.post(
    "/payments/:id/approve",
    asyncHandler(async (req, res) => {
      const actor = currentUser(res);
      const payment = db.payments.get(String(req.params.id));
      if (!payment) throw new HttpError(404, "not_found", "That payment does not exist.");
      if (payment.status !== "pending") {
        throw new HttpError(409, "already_reviewed", "That payment was already reviewed.");
      }
      const input = parseBody(reviewSchema, req.body);

      payment.status = "approved";
      payment.reviewedAt = nowIso();
      payment.reviewedBy = actor.email;
      payment.reviewNote = input.reviewNote;

      const subscription = db.subscriptions.get(payment.userId) ?? createTrialSubscription(payment.userId);
      subscription.planId = payment.planId;
      subscription.status = "active";
      subscription.currentPeriodEnd = new Date(
        Date.now() + planDurationDays(payment.planId) * MS_PER_DAY,
      ).toISOString();
      subscription.note = `Activated by ${actor.email} after verifying ${payment.method} ${payment.reference}.`;
      subscription.updatedAt = nowIso();
      subscription.updatedBy = actor.id;
      db.subscriptions.set(payment.userId, subscription);

      log(
        db,
        actor,
        "owner.payment_approved",
        `${payment.userEmail} ${payment.planName} (${payment.reference})`,
      );
      save(db);
      res.json({ item: payment, subscription, entitlement: computeEntitlement(subscription) });
    }),
  );

  router.post(
    "/payments/:id/reject",
    asyncHandler(async (req, res) => {
      const actor = currentUser(res);
      const payment = db.payments.get(String(req.params.id));
      if (!payment) throw new HttpError(404, "not_found", "That payment does not exist.");
      if (payment.status !== "pending") {
        throw new HttpError(409, "already_reviewed", "That payment was already reviewed.");
      }
      const input = parseBody(reviewSchema, req.body);

      payment.status = "rejected";
      payment.reviewedAt = nowIso();
      payment.reviewedBy = actor.email;
      payment.reviewNote = input.reviewNote;

      const subscription = db.subscriptions.get(payment.userId) ?? createTrialSubscription(payment.userId);
      const trialActive = new Date(subscription.trialEndsAt).getTime() > Date.now();
      subscription.planId = "free";
      subscription.status = trialActive ? "trialing" : "expired";
      subscription.note = `Payment ${payment.reference} was rejected by ${actor.email}.`;
      subscription.updatedAt = nowIso();
      subscription.updatedBy = actor.id;
      db.subscriptions.set(payment.userId, subscription);

      log(db, actor, "owner.payment_rejected", `${payment.userEmail} (${payment.reference})`);
      save(db);
      res.json({ item: payment, subscription, entitlement: computeEntitlement(subscription) });
    }),
  );

  router.patch(
    "/payment-settings",
    asyncHandler(async (req, res) => {
      const actor = currentUser(res);
      const input = parseBody(settingsSchema, req.body);
      db.settings = {
        afrimoneyNumber: input.afrimoneyNumber,
        orangeMoneyNumber: input.orangeMoneyNumber,
        accountName: input.accountName,
        instructions: input.instructions,
        updatedAt: nowIso(),
        updatedBy: actor.email,
      };
      log(db, actor, "owner.payment_settings_updated", "Manual payment receiving details changed");
      save(db);
      res.json({ payments: db.settings });
    }),
  );

  router.get("/audit", (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    res.json({ items: db.audit.slice(0, limit) });
  });

  return router;
}
