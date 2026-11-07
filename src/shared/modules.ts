/**
 * The single source of truth for NOVA's modules.
 *
 * Navigation, routing, permission checks and the dashboard all read from this
 * list, so adding a module in one place wires up the sidebar, the route guard
 * and the owner permission matrix together.
 */

export type ModuleGroup = "Core" | "Create" | "Work" | "Account";

export interface ModuleDefinition {
  /** Stable identifier, also used as the permission key. */
  id: string;
  title: string;
  /** Client-side route path. */
  path: string;
  summary: string;
  group: ModuleGroup;
  icon: IconName;
  /** Only owners can reach this module, regardless of grants. */
  ownerOnly: boolean;
}

export type IconName =
  | "grid"
  | "spark"
  | "chat"
  | "memory"
  | "palette"
  | "image"
  | "video"
  | "code"
  | "research"
  | "files"
  | "browser"
  | "productivity"
  | "plans"
  | "settings"
  | "shield"
  | "logout"
  | "send"
  | "plus"
  | "trash"
  | "menu"
  | "close"
  | "check";

export const MODULES: ModuleDefinition[] = [
  {
    id: "dashboard",
    title: "Home Dashboard",
    path: "/app",
    summary: "System overview, activity and quick actions",
    group: "Core",
    icon: "grid",
    ownerOnly: false,
  },
  {
    id: "assistant",
    title: "AI Assistant",
    path: "/app/assistant",
    summary: "Chat with Gemini through the NOVA server",
    group: "Core",
    icon: "spark",
    ownerOnly: false,
  },
  {
    id: "messages",
    title: "AI Messages",
    path: "/app/messages",
    summary: "Conversation archive and transcripts",
    group: "Core",
    icon: "chat",
    ownerOnly: false,
  },
  {
    id: "memory",
    title: "Memory Centre",
    path: "/app/memory",
    summary: "Durable facts injected into assistant context",
    group: "Core",
    icon: "memory",
    ownerOnly: false,
  },
  {
    id: "creative",
    title: "Creative Studio",
    path: "/app/creative",
    summary: "Briefs, concepts and project boards",
    group: "Create",
    icon: "palette",
    ownerOnly: false,
  },
  {
    id: "images",
    title: "Image Generation",
    path: "/app/images",
    summary: "Gemini image model, prepared server-side",
    group: "Create",
    icon: "image",
    ownerOnly: false,
  },
  {
    id: "video",
    title: "Video Generation",
    path: "/app/video",
    summary: "Video pipeline readiness and honest status",
    group: "Create",
    icon: "video",
    ownerOnly: false,
  },
  {
    id: "code",
    title: "Coding Lab",
    path: "/app/code",
    summary: "Snippet library with language tagging",
    group: "Work",
    icon: "code",
    ownerOnly: false,
  },
  {
    id: "research",
    title: "Research Centre",
    path: "/app/research",
    summary: "Reading queue and source tracking",
    group: "Work",
    icon: "research",
    ownerOnly: false,
  },
  {
    id: "files",
    title: "File Manager",
    path: "/app/files",
    summary: "Private per-account file storage",
    group: "Work",
    icon: "files",
    ownerOnly: false,
  },
  {
    id: "browser",
    title: "Browser",
    path: "/app/browser",
    summary: "Guarded in-app page reader",
    group: "Work",
    icon: "browser",
    ownerOnly: false,
  },
  {
    id: "productivity",
    title: "Productivity Centre",
    path: "/app/productivity",
    summary: "Tasks and notes in one workspace",
    group: "Work",
    icon: "productivity",
    ownerOnly: false,
  },
  {
    id: "plans",
    title: "Subscription Plans",
    path: "/app/plans",
    summary: "Plan comparison without fake checkout",
    group: "Account",
    icon: "plans",
    ownerOnly: false,
  },
  {
    id: "settings",
    title: "Settings",
    path: "/app/settings",
    summary: "Profile, security and preferences",
    group: "Account",
    icon: "settings",
    ownerOnly: false,
  },
  {
    id: "owner",
    title: "Owner Control Centre",
    path: "/app/owner",
    summary: "Users, permissions and audit trail",
    group: "Account",
    icon: "shield",
    ownerOnly: true,
  },
];

export const MODULE_IDS = MODULES.map((module) => module.id);

export function findModuleByPath(path: string): ModuleDefinition | undefined {
  const normalised = path.replace(/\/+$/, "") || "/";
  return MODULES.find((module) => module.path === normalised);
}

export function findModuleById(id: string): ModuleDefinition | undefined {
  return MODULES.find((module) => module.id === id);
}

/**
 * Resolves the effective access a user has to a module.
 * Owners implicitly hold every grant; members are limited by their grants.
 */
export function canAccessModule(
  user: { role: "owner" | "member"; permissions: { modules: string[] | "all" } },
  module: ModuleDefinition,
): boolean {
  if (module.ownerOnly) return user.role === "owner";
  if (user.role === "owner") return true;
  const grants = user.permissions.modules;
  if (grants === "all") return true;
  return grants.includes(module.id);
}

export function accessibleModuleIds(user: {
  role: "owner" | "member";
  permissions: { modules: string[] | "all" };
}): string[] {
  return MODULES.filter((module) => canAccessModule(user, module)).map((module) => module.id);
}
