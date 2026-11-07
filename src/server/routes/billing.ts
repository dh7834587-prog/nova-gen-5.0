import { Router } from "express";
import { z } from "zod";
import { PLANS, computeEntitlement, createTrialSubscription, findPlan } from "../../shared/plans.js";
import type { CustomPlanRequest, PaymentSubmission, PlanCatalogue, PlanId } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { newId, nowIso, type Database } from "../store.js";

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

const customRequestSchema = z.object({
  requirements: z.string().trim().min(10, "Describe what you need so the owner can quote it.").max(2000),
  scale: z.enum(["personal", "team", "business"]).default("personal"),
  durationPreference: z.string().trim().max(80).default(""),
});

function subscriptionFor(db: Database, userId: string) {
  const existing = db.subscriptions.get(userId) ?? createTrialSubscription(userId);
  db.subscriptions.set(userId, existing);
  return existing;
}

/** Payments are keyed by submitter, not by an `ownerId` field, so filter directly. */
function paymentsFor(db: Database, userId: string): PaymentSubmission[] {
  return [...db.payments.values()]
    .filter((payment) => payment.userId === userId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
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
    "/custom-requests",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(customRequestSchema, req.body);
      const open = [...db.customRequests.values()].filter(
        (request) => request.userId === user.id && request.status !== "declined" && request.status !== "activated",
      );
      if (open.length >= 3) {
        throw new HttpError(
          409,
          "request_limit",
          "You already have custom requests awaiting the owner. Wait for a reply before adding another.",
        );
      }
      const at = nowIso();
      const request: CustomPlanRequest = {
        id: newId(),
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        requirements: input.requirements,
        scale: input.scale,
        durationPreference: input.durationPreference,
        status: "submitted",
        quote: null,
        ownerNote: "",
        createdAt: at,
        updatedAt: at,
      };
      db.customRequests.set(request.id, request);
      log(db, user, "billing.custom_request_submitted", input.requirements.slice(0, 160));
      save(db);
      res.status(201).json({
        item: request,
        message:
          "Your brief is with the owner. No price or access is confirmed until the owner sends a " +
          "quotation and you accept it.",
      });
    }),
  );

  router.get("/custom-requests", (_req, res) => {
    const user = currentUser(res);
    const mine = [...db.customRequests.values()]
      .filter((request) => request.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ items: mine });
  });

  router.post(
    "/custom-requests/:id/accept",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const request = db.customRequests.get(String(req.params.id));
      if (!request || request.userId !== user.id) {
        throw new HttpError(404, "not_found", "That custom request does not exist.");
      }
      if (request.status !== "quoted" || !request.quote) {
        throw new HttpError(409, "no_quote", "The owner has not sent a quotation for this request yet.");
      }
      request.status = "accepted";
      request.updatedAt = nowIso();
      db.customRequests.set(request.id, request);

      const subscription = subscriptionFor(db, user.id);
      subscription.planId = "custom";
      subscription.status = "pending_approval";
      subscription.customQuote = `${request.quote.priceLabel} · ${request.quote.durationDays} days · ${request.quote.usageLimit}`;
      subscription.note =
        "Custom quotation accepted. The owner activates the plan after confirming payment.";
      subscription.updatedAt = nowIso();
      subscription.updatedBy = user.id;

      log(db, user, "billing.custom_quote_accepted", request.quote.priceLabel);
      save(db);
      res.json({
        item: request,
        entitlement: computeEntitlement(subscription),
        message:
          "Quotation accepted. Your plan stays inactive until the owner confirms payment and " +
          "activates the custom subscription.",
      });
    }),
  );

  router.post(
    "/custom-requests/:id/decline",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const request = db.customRequests.get(String(req.params.id));
      if (!request || request.userId !== user.id) {
        throw new HttpError(404, "not_found", "That custom request does not exist.");
      }
      if (request.status !== "quoted") {
        throw new HttpError(409, "no_quote", "There is no open quotation to decline.");
      }
      request.status = "declined";
      request.updatedAt = nowIso();
      db.customRequests.set(request.id, request);
      log(db, user, "billing.custom_quote_declined", request.id);
      save(db);
      res.json({ item: request });
    }),
  );

  return router;
}
