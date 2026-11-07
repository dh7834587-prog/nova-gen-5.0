import { Router } from "express";
import { z } from "zod";
import { PLANS, computeEntitlement, createTrialSubscription, findPlan } from "../../shared/plans.js";
import type { PaymentSubmission, PlanCatalogue, PlanId } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { listOwned, newId, nowIso, type Database } from "../store.js";

const paymentSchema = z.object({
  planId: z.enum(["premium-monthly", "premium-yearly"]),
  method: z.enum(["afrimoney", "orange_money"]),
  senderName: z.string().trim().min(2, "Enter the name on the sending account.").max(80),
  senderPhone: z
    .string()
    .trim()
    .min(6, "Enter the phone number that sent the money.")
    .max(24)
    .regex(/^[0-9+()\s-]+$/, "Phone numbers can only contain digits, spaces and + ( ) -"),
  reference: z.string().trim().min(4, "Enter the transaction reference.").max(64),
  note: z.string().trim().max(400).default(""),
});

const quoteSchema = z.object({
  details: z.string().trim().min(10, "Describe what you need so the owner can quote it.").max(1000),
});

function subscriptionFor(db: Database, userId: string) {
  const existing = db.subscriptions.get(userId) ?? createTrialSubscription(userId);
  db.subscriptions.set(userId, existing);
  return existing;
}

export function billingRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser);

  router.get("/plans", (_req, res) => {
    const user = currentUser(res);
    const subscription = subscriptionFor(db, user.id);
    const mine = paymentsFor(db, user.id);

    const catalogue: PlanCatalogue = {
      plans: PLANS,
      payments: db.settings,
      entitlement: computeEntitlement(subscription),
      pendingPayments: mine.filter((payment) => payment.status === "pending"),
      history: mine.filter((payment) => payment.status !== "pending"),
      verificationMode: "manual",
      notice:
        "NOVA never confirms a payment automatically. Send the exact amount, submit the " +
        "transaction reference, and the owner activates the plan after checking the transfer.",
    };
    res.json({ catalogue });
  });

  router.post(
    "/payments",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(paymentSchema, req.body);
      const plan = findPlan(input.planId as PlanId);

      const duplicate = [...db.payments.values()].find(
        (payment) =>
          payment.userId === user.id &&
          payment.reference.toLowerCase() === input.reference.toLowerCase(),
      );
      if (duplicate) {
        throw new HttpError(
          409,
          "duplicate_reference",
          "That transaction reference was already submitted. Check your payment history.",
        );
      }

      const submission: PaymentSubmission = {
        id: newId(),
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        planId: plan.id,
        planName: plan.name,
        method: input.method,
        amountLabel: plan.priceLabel,
        senderName: input.senderName,
        senderPhone: input.senderPhone,
        reference: input.reference,
        note: input.note,
        status: "pending",
        submittedAt: nowIso(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: "",
      };
      db.payments.set(submission.id, submission);

      const subscription = subscriptionFor(db, user.id);
      subscription.planId = plan.id;
      subscription.status = "pending_approval";
      subscription.note = `Awaiting owner verification of ${plan.name} payment (${input.reference}).`;
      subscription.updatedAt = nowIso();
      subscription.updatedBy = user.id;

      log(
        db,
        user,
        "billing.payment_submitted",
        `${plan.name} via ${input.method} ref ${input.reference}`,
      );
      save(db);

      res.status(201).json({
        item: submission,
        entitlement: computeEntitlement(subscription),
        message:
          "Payment submitted. Nothing is activated yet: the owner verifies the transfer and " +
          "approves it before your plan changes.",
      });
    }),
  );

  router.get("/payments", (_req, res) => {
    const user = currentUser(res);
    const mine = paymentsFor(db, user.id);
    res.json({
      pending: mine.filter((payment) => payment.status === "pending"),
      history: mine.filter((payment) => payment.status !== "pending"),
    });
  });

  router.post(
    "/custom-quote",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(quoteSchema, req.body);
      const subscription = subscriptionFor(db, user.id);
      subscription.customQuote = input.details;
      subscription.note = "Custom plan brief sent to the owner for a quote.";
      subscription.updatedAt = nowIso();
      subscription.updatedBy = user.id;
      log(db, user, "billing.custom_quote_requested", input.details.slice(0, 160));
      save(db);
      res.status(201).json({
        entitlement: computeEntitlement(subscription),
        message:
          "Your brief was sent to the owner. Custom plans are individually quoted, so no price " +
          "or activation is confirmed until the owner replies.",
      });
    }),
  );

  return router;
}
