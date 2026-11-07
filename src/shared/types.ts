/**
 * Shared domain contracts used by both the API server and the browser client.
 * Keeping these in one place means the module registry, permission keys and
 * payload shapes cannot drift between the two halves of the app.
 */

export type Role = "owner" | "member";
export type UserStatus = "active" | "suspended";

/** Per-user module grants. `"all"` is the default for new accounts. */
export type ModuleGrant = string[] | "all";

export interface UserPermissions {
  modules: ModuleGrant;
  aiAccess: boolean;
}

export interface UserPreferences {
  accent: "violet" | "purple" | "indigo";
  compactNav: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  permissions: UserPermissions;
  preferences: UserPreferences;
  createdAt: string;
  lastLoginAt: string | null;
  /** Null until the owner delivers a verification link. */
  emailVerifiedAt?: string | null;
}

export interface StoredUser extends PublicUser {
  passwordHash: string;
  passwordSalt: string;
}

export interface SessionInfo {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
}

export interface Conversation {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export type MemoryCategory = "identity" | "preference" | "project" | "goal" | "reference" | "other";

export interface MemoryRecord {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  category: MemoryCategory;
  reviewStatus: "pending" | "approved";
  createdAt: string;
  updatedAt: string;
}

/** A rendered image kept in the user's private generation history. */
export interface GeneratedImage {
  id: string;
  ownerId: string;
  prompt: string;
  mimeType: string;
  model: string;
  createdAt: string;
}

export interface GeneratedImageRecord extends GeneratedImage {
  /** Base64 payload; only returned by the owning user's own endpoints. */
  data: string;
}

export interface BookmarkRecord {
  id: string;
  ownerId: string;
  title: string;
  url: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowsingHistoryRecord {
  id: string;
  ownerId: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/** Per-user, per-day metering used to enforce plan limits honestly. */
export interface UsageRecord {
  userId: string;
  day: string;
  chatMessages: number;
  images: number;
  research: number;
  updatedAt: string;
}

export interface UsageLimits {
  chatMessages: number;
  images: number;
  research: number;
}

export interface UsageSummary {
  day: string;
  used: UsageLimits;
  limits: UsageLimits;
  unlimited: boolean;
}

export type CustomRequestStatus = "submitted" | "quoted" | "accepted" | "declined" | "activated";

export interface CustomQuote {
  priceLabel: string;
  durationDays: number;
  usageLimit: string;
  note: string;
  quotedAt: string;
  quotedBy: string | null;
}

export interface CustomPlanRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  requirements: string;
  scale: string;
  durationPreference: string;
  status: CustomRequestStatus;
  quote: CustomQuote | null;
  ownerNote: string;
  createdAt: string;
  updatedAt: string;
}

/** Server-side one-time token, surfaced to the owner for manual delivery. */
export interface PendingAuthToken {
  id: string;
  email: string;
  purpose: "password_reset" | "email_verification";
  createdAt: string;
  expiresAt: string;
  /** Minted once for the owner; never re-readable from the queue. */
  link: string | null;
}

export interface ProviderUsage {
  promptChars: number;
  replyChars: number;
  requests: number;
}

export interface TaskRecord {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high";
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRecord {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetRecord {
  id: string;
  ownerId: string;
  title: string;
  language: string;
  code: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRecord {
  id: string;
  ownerId: string;
  title: string;
  url: string;
  summary: string;
  tags: string[];
  status: "queued" | "reading" | "done";
  createdAt: string;
  updatedAt: string;
}

export interface CreativeProject {
  id: string;
  ownerId: string;
  title: string;
  brief: string;
  medium: "image" | "video" | "text" | "mixed";
  status: "draft" | "active" | "archived";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface StoredFile extends FileRecord {
  data: Buffer;
}

export interface ReadPageResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  links: { href: string; label: string }[];
  truncated: boolean;
}

/* ------------------------------------------------------------------ *
 * Billing: plans, trial entitlement, manual mobile-money payments
 * ------------------------------------------------------------------ */

export type PlanId = "free" | "premium-monthly" | "premium-yearly" | "custom";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceLabel: string;
  cadence: string;
  tagline: string;
  features: string[];
  highlighted: boolean;
  available: boolean;
  /** `true` when the plan can be requested through a manual payment. */
  purchasable: boolean;
}

export type SubscriptionStatus =
  | "trialing"
  | "pending_approval"
  | "active"
  | "expired"
  | "cancelled";

export interface SubscriptionRecord {
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  customQuote: string;
  note: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** Effective access rights derived from a subscription and the current clock. */
export interface Entitlement {
  planId: PlanId;
  planName: string;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  daysRemaining: number;
  aiAllowed: boolean;
  customQuote: string;
  reason: string | null;
}

export type PaymentMethod = "afrimoney" | "orange_money";
export type PaymentStatus = "pending" | "approved" | "rejected";

export interface PaymentSubmission {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  planId: PlanId;
  planName: string;
  method: PaymentMethod;
  amountLabel: string;
  senderName: string;
  senderPhone: string;
  reference: string;
  note: string;
  status: PaymentStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string;
}

/** Receiving numbers for manual transfers. Never a client-side secret. */
export interface PaymentSettings {
  afrimoneyNumber: string;
  orangeMoneyNumber: string;
  accountName: string;
  instructions: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PlanCatalogue {
  plans: PlanDefinition[];
  payments: PaymentSettings;
  entitlement: Entitlement;
  pendingPayments: PaymentSubmission[];
  history: PaymentSubmission[];
  verificationMode: "manual";
  notice: string;
}

/* ------------------------------------------------------------------ *
 * Authentication providers (email is live, social is prepared)
 * ------------------------------------------------------------------ */

export type OAuthProvider = "google" | "facebook";

export interface AuthProviderStatus {
  provider: OAuthProvider;
  label: string;
  configured: boolean;
  /** Honest explanation shown in the UI when credentials are absent. */
  reason: string | null;
}

export interface ProviderStatus {
  configured: boolean;
  chatModel: string;
  imageModel: string;
  videoConfigured: boolean;
  reason: string | null;
}

export interface DashboardStats {
  conversations: number;
  memories: number;
  tasksOpen: number;
  tasksDone: number;
  notes: number;
  snippets: number;
  research: number;
  creative: number;
  files: number;
  fileBytes: number;
}

export interface DashboardResponse {
  user: PublicUser;
  stats: DashboardStats;
  provider: ProviderStatus;
  recentActivity: AuditEvent[];
  recentConversations: ConversationSummary[];
  recentProjects: CreativeProject[];
  accessibleModules: string[];
  entitlement: Entitlement;
}

export interface OwnerOverview {
  users: PublicUser[];
  subscriptions: {
    userId: string;
    email: string;
    planId: PlanId;
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
    trialEndsAt: string;
  }[];
  payments: PaymentSubmission[];
  audit: AuditEvent[];
  paymentSettings: PaymentSettings;
  customRequests: CustomPlanRequest[];
  usage: { userId: string; email: string; day: string; chatMessages: number; images: number; research: number }[];
  trialDays: number;
  pendingAuthTokens: PendingAuthToken[];
  stats: {
    users: number;
    activeUsers: number;
    owners: number;
    suspended: number;
    pendingPayments: number;
    activeSubscriptions: number;
  };
}

/** Server-sent events emitted by `POST /api/assistant/stream`. */
export type AssistantStreamEvent =
  | { type: "meta"; conversationId: string; title: string; model: string }
  | { type: "delta"; text: string }
  | { type: "done"; conversationId: string; title: string; message: ChatMessage }
  | { type: "error"; code: string; message: string };

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
