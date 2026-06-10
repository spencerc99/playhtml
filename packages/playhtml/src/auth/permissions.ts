// ABOUTME: Client-side permissions state: rule/role resolution, the synchronous can()
// ABOUTME: check, permissions attribute parsing, and identity/permissions change events.

import type {
  PermissionAction,
  PermissionRule,
  EnforceableRoles,
  PermissionsStatusMessage,
  PlayerIdentity,
  RoleRef,
} from "@playhtml/common";
import {
  PERMISSION_ACTIONS,
  requiredRolesForAction,
  satisfiesRole,
} from "@playhtml/common";

export const IDENTITY_CHANGE_EVENT = "playhtml:identitychange";
export const PERMISSIONS_CHANGE_EVENT = "playhtml:permissionschange";
export const PERMISSION_DENIED_EVENT = "permissiondenied";

/**
 * Client role conditions are evaluated locally and are UX gating only — they
 * cannot be enforced by the server (arbitrary functions don't travel). Use
 * explicit public-key lists for anything that must hold against adversaries.
 */
export type RoleCondition = (context: {
  pid: string | undefined;
  name: string | undefined;
  verified: boolean;
  domain: string;
}) => boolean;

export interface PermissionsConfig {
  roles?: Record<string, string[] | RoleCondition>;
  rules?: PermissionRule[];
}

export interface MeState {
  pid: string | undefined;
  name: string | undefined;
  source: PlayerIdentity["source"];
  verified: boolean;
  roles: string[];
  /** True when the server confirmed domain-bound enforcement for this room. */
  enforced: boolean;
}

interface PermissionsState {
  config: PermissionsConfig;
  serverStatus: PermissionsStatusMessage | null;
  identity: PlayerIdentity | null;
  verified: boolean;
  resolvedRoles: string[];
}

const state: PermissionsState = {
  config: {},
  serverStatus: null,
  identity: null,
  verified: false,
  resolvedRoles: [],
};

export function configurePermissions(config: PermissionsConfig): void {
  state.config = config;
  resolveRoles();
}

export function setServerPermissionsStatus(
  status: PermissionsStatusMessage | null,
): void {
  state.serverStatus = status;
  resolveRoles();
  document.dispatchEvent(
    new CustomEvent(PERMISSIONS_CHANGE_EVENT, { detail: getMe() }),
  );
}

export function setIdentity(identity: PlayerIdentity | null): void {
  state.identity = identity;
  resolveRoles();
  document.dispatchEvent(
    new CustomEvent(IDENTITY_CHANGE_EVENT, { detail: getMe() }),
  );
}

export function setVerified(verified: boolean): void {
  if (state.verified === verified) return;
  state.verified = verified;
  resolveRoles();
  document.dispatchEvent(
    new CustomEvent(IDENTITY_CHANGE_EVENT, { detail: getMe() }),
  );
}

export function getMe(): MeState {
  return {
    pid: state.identity?.publicKey,
    name: state.identity?.name,
    source: state.identity?.source,
    verified: state.verified,
    roles: [...state.resolvedRoles],
    enforced: state.serverStatus?.enforced ?? false,
  };
}

/** Test-only: returns permissions state to its initial empty shape. */
export function __resetPermissionsForTests(): void {
  state.config = {};
  state.serverStatus = null;
  state.identity = null;
  state.verified = false;
  state.resolvedRoles = [];
}

/**
 * Resolves which named roles the current identity holds, combining client
 * config roles (key lists + condition functions) with server-published role
 * lists. Evaluated on config/identity/verification changes — never per check,
 * so can() stays synchronous and cheap.
 */
function resolveRoles(): void {
  const pid = state.identity?.publicKey;
  const roles = new Set<string>();

  const context = {
    pid,
    name: state.identity?.name,
    verified: state.verified,
    domain: typeof window !== "undefined" ? window.location.hostname : "",
  };

  for (const [name, definition] of Object.entries(state.config.roles ?? {})) {
    if (Array.isArray(definition)) {
      if (pid && definition.includes(pid)) roles.add(name);
    } else if (typeof definition === "function") {
      try {
        if (definition(context)) roles.add(name);
      } catch (error) {
        console.error(`[playhtml] Role condition "${name}" threw:`, error);
      }
    }
  }

  for (const [name, members] of Object.entries(state.serverStatus?.roles ?? {})) {
    if (pid && members.includes(pid)) roles.add(name);
  }

  state.resolvedRoles = Array.from(roles);
}

/** Key-list roles resolvable client-side, merged from config + server status. */
function combinedKeyRoles(): EnforceableRoles {
  const combined: EnforceableRoles = {};
  for (const [name, definition] of Object.entries(state.config.roles ?? {})) {
    if (Array.isArray(definition)) combined[name] = definition;
  }
  for (const [name, members] of Object.entries(state.serverStatus?.roles ?? {})) {
    combined[name] = [...(combined[name] ?? []), ...members];
  }
  return combined;
}

/**
 * Parses an element's `permissions` attribute: comma-separated
 * `action:role` entries; multiple acceptable roles join with "|".
 * Example: `permissions="write:admin, delete:admin|creator"`.
 */
export function parsePermissionsAttribute(
  value: string,
): Partial<Record<PermissionAction, RoleRef>> {
  const parsed: Partial<Record<PermissionAction, RoleRef>> = {};
  for (const entry of value.split(",")) {
    const [action, roleSpec] = entry.split(":").map((s) => s.trim());
    if (!action || !roleSpec) continue;
    if (!(PERMISSION_ACTIONS as string[]).includes(action)) {
      console.warn(`[playhtml] Unknown permission action "${action}" in attribute`);
      continue;
    }
    const roleList = roleSpec.split("|").map((s) => s.trim()).filter(Boolean);
    parsed[action as PermissionAction] =
      roleList.length === 1 ? roleList[0] : roleList;
  }
  return parsed;
}

function resolveTarget(
  target: HTMLElement | string,
): { element: HTMLElement | null; elementId: string | null } {
  if (typeof target === "string") {
    const elementId = target.startsWith("#") ? target.slice(1) : target;
    return { element: document.getElementById(elementId), elementId };
  }
  return { element: target, elementId: target.id || null };
}

/**
 * Required roles for an action on a target, or null when unrestricted.
 * Precedence: element `permissions` attribute, then client init rules
 * (CSS-selector aware), then server-published rules.
 */
function requiredRolesForTarget(
  action: PermissionAction,
  element: HTMLElement | null,
  elementId: string | null,
): RoleRef | null {
  if (element) {
    const attr = element.getAttribute("permissions");
    if (attr) {
      const parsed = parsePermissionsAttribute(attr);
      const specific = parsed[action] ?? (action !== "write" ? parsed.write : undefined);
      if (specific !== undefined) return specific;
    }
  }

  for (const rule of state.config.rules ?? []) {
    const matches = element
      ? safeMatches(element, rule.match) ||
        (elementId !== null && idMatches(rule.match, elementId))
      : elementId !== null && idMatches(rule.match, elementId);
    if (!matches) continue;
    const specific = rule[action];
    if (specific !== undefined) return specific;
    if (action !== "write" && rule.write !== undefined) return rule.write;
  }

  if (state.serverStatus && elementId !== null) {
    return requiredRolesForAction(
      state.serverStatus.rules,
      elementId,
      action,
      state.serverStatus.roomPath,
    );
  }

  return null;
}

function idMatches(pattern: string, elementId: string): boolean {
  const p = pattern.startsWith("#") ? pattern.slice(1) : pattern;
  if (p.endsWith("*")) return elementId.startsWith(p.slice(0, -1));
  return p === elementId;
}

function safeMatches(element: HTMLElement, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/**
 * Synchronous permission check against the resolved-role cache. This is UX
 * gating: it never blocks an attacker (the server does), but it's what UIs
 * and setData use to decide affordances and local writes.
 *
 * For "creator"-scoped collection rules, pass the entry's recorded creator
 * pid via options so the check can compare it to the current identity.
 */
export function can(
  action: PermissionAction,
  target: HTMLElement | string,
  options: { creator?: string } = {},
): boolean {
  const { element, elementId } = resolveTarget(target);
  const required = requiredRolesForTarget(action, element, elementId);
  if (required === null) return true;

  const pid = state.identity?.publicKey;
  const principal = {
    pid,
    verified: state.verified,
    isCreator: options.creator !== undefined && options.creator === pid,
  };

  const requiredList = Array.isArray(required) ? required : [required];
  // Named roles resolved in the cache count directly (covers condition roles
  // the pure helper can't see); fall through to the shared key-list check.
  for (const roleName of requiredList) {
    if (state.resolvedRoles.includes(roleName)) return true;
  }
  return satisfiesRole(required, principal, combinedKeyRoles());
}

/**
 * True when writes to this element must be routed through the server's
 * gated-write path (the room has server enforcement and a rule matches).
 */
export function isServerGated(elementId: string): boolean {
  const status = state.serverStatus;
  if (!status?.enforced) return false;
  return PERMISSION_ACTIONS.some(
    (action) =>
      requiredRolesForAction(status.rules, elementId, action, status.roomPath) !==
      null,
  );
}

/**
 * True when any permission gating (attribute, client rules, or server rules)
 * applies to the element — i.e. setData should run the can() check at all.
 */
export function isLocallyGated(
  element: HTMLElement,
  elementId: string,
): boolean {
  if (element.hasAttribute("permissions")) return true;
  for (const rule of state.config.rules ?? []) {
    if (safeMatches(element, rule.match) || idMatches(rule.match, elementId)) {
      return true;
    }
  }
  return isServerGated(elementId);
}

export function dispatchPermissionDenied(
  element: HTMLElement,
  detail: { action: PermissionAction; elementId: string; reason: string },
): void {
  console.warn(
    `[playhtml] Permission denied: ${detail.action} on #${detail.elementId} (${detail.reason})`,
  );
  element.dispatchEvent(
    new CustomEvent(PERMISSION_DENIED_EVENT, { detail, bubbles: true }),
  );
}
