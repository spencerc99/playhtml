// ABOUTME: Client-side permissions state: rule/role resolution, the synchronous can()
// ABOUTME: check, permissions attribute parsing, and identity/permissions change events.

import type {
  Counters,
  PermissionAction,
  PermissionActionSpec,
  PermissionRule,
  ElementRulesMap,
  EnforceableRoles,
  PermissionsStatusMessage,
  PlayerIdentity,
  RoleRef,
} from "@playhtml/common";
import {
  PERMISSION_ACTIONS,
  isEarnedRoleCondition,
  looksLikeCssSelector,
  matchesRulePattern,
  meetsEarnedCondition,
  normalizeElementRules,
  parsePermissionsSpec,
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
  /**
   * The ergonomic form: element id pattern (or CSS selector, client-only) ->
   * permissions spec, using the same mini-language as the `permissions`
   * attribute. Raw "pk_…" keys work anywhere a role name does.
   * Example: { "#site-title": "write:admin" }
   */
  elements?: ElementRulesMap;
  /** Low-level rule list; `elements` is normalized into this form. */
  rules?: PermissionRule[];
}

export interface MeState {
  pid: string | undefined;
  name: string | undefined;
  source: PlayerIdentity["source"];
  verified: boolean;
  roles: string[];
  /**
   * Server-attested counter totals for this identity in the room (undefined
   * until the handshake completes). Powers earned roles like `{ days: 2 }`.
   */
  counters: Counters | undefined;
  /** True when `entry.createdBy` is this player's pid. */
  owns: (entry: unknown) => boolean;
}

interface PermissionsState {
  config: PermissionsConfig;
  /** Client rules normalized from config.elements + config.rules. */
  clientRules: PermissionRule[];
  serverStatus: PermissionsStatusMessage | null;
  identity: PlayerIdentity | null;
  verified: boolean;
  /** Server-attested counter totals (from auth_ok). */
  counters: Counters | undefined;
  resolvedRoles: string[];
}

const state: PermissionsState = {
  config: {},
  clientRules: [],
  serverStatus: null,
  identity: null,
  verified: false,
  counters: undefined,
  resolvedRoles: [],
};

export function configurePermissions(config: PermissionsConfig): void {
  state.config = config;
  state.clientRules = [
    ...normalizeElementRules(config.elements ?? {}),
    ...(config.rules ?? []),
  ];
  resolveRoles();
}

export function setServerPermissionsStatus(
  status: PermissionsStatusMessage | null,
): void {
  state.serverStatus = status;
  if (status?.enforced) warnOnClientServerDrift(status);
  resolveRoles();
  document.dispatchEvent(
    new CustomEvent(PERMISSIONS_CHANGE_EVENT, { detail: getMe() }),
  );
}

/**
 * Dev-aid: when the room has server enforcement, client rules that the server
 * doesn't know about are UX-only — either intentionally (CSS selectors,
 * condition roles) or because the init config drifted from the well-known
 * file. Surface both so the gap is never silent.
 */
function warnOnClientServerDrift(status: PermissionsStatusMessage): void {
  const serverPatterns = new Set(status.rules.map((rule) => rule.match));
  for (const rule of state.clientRules) {
    if (serverPatterns.has(rule.match)) continue;
    if (looksLikeCssSelector(rule.match)) {
      console.warn(
        `[playhtml] Permission rule "${rule.match}" uses a CSS selector — it ` +
          `gates UX only and cannot be enforced by the server. Use an element ` +
          `id (or trailing-* glob) in .well-known/playhtml.json to enforce it.`,
      );
    } else {
      console.warn(
        `[playhtml] Permission rule "${rule.match}" is declared in init() but ` +
          `not in this domain's .well-known/playhtml.json — it gates UX only. ` +
          `Add it to the well-known file to enforce it (client config may have drifted).`,
      );
    }
  }
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

/** Records the server-attested counter totals (arrive with auth_ok). */
export function setCounters(counters: Counters): void {
  if (
    state.counters?.days === counters.days &&
    state.counters?.sessions === counters.sessions
  ) {
    return;
  }
  state.counters = counters;
  resolveRoles();
  document.dispatchEvent(
    new CustomEvent(IDENTITY_CHANGE_EVENT, { detail: getMe() }),
  );
}

export function getMe(): MeState {
  const pid = state.identity?.publicKey;
  return {
    pid,
    name: state.identity?.name,
    source: state.identity?.source,
    verified: state.verified,
    counters: state.counters,
    roles: [...state.resolvedRoles],
    owns: (entry: unknown) =>
      pid !== undefined &&
      typeof entry === "object" &&
      entry !== null &&
      (entry as { createdBy?: unknown }).createdBy === pid,
  };
}

/** True when the server confirmed domain-bound enforcement for this room. */
export function isServerEnforced(): boolean {
  return state.serverStatus?.enforced ?? false;
}

/** Test-only: returns permissions state to its initial empty shape. */
export function __resetPermissionsForTests(): void {
  state.config = {};
  state.clientRules = [];
  state.serverStatus = null;
  state.identity = null;
  state.verified = false;
  state.counters = undefined;
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

  for (const [name, definition] of Object.entries(
    state.serverStatus?.roles ?? {},
  )) {
    if (isEarnedRoleCondition(definition)) {
      if (state.verified && meetsEarnedCondition(definition, state.counters)) {
        roles.add(name);
      }
    } else if (pid && definition.includes(pid)) {
      roles.add(name);
    }
  }

  state.resolvedRoles = Array.from(roles);
}

/** Roles resolvable client-side, merged from config + server status. */
function combinedKeyRoles(): EnforceableRoles {
  const combined: EnforceableRoles = {};
  for (const [name, definition] of Object.entries(state.config.roles ?? {})) {
    if (Array.isArray(definition)) combined[name] = definition;
  }
  for (const [name, definition] of Object.entries(
    state.serverStatus?.roles ?? {},
  )) {
    if (isEarnedRoleCondition(definition)) {
      // Earned conditions come only from the server (it owns the counters).
      combined[name] = definition;
    } else {
      const existing = combined[name];
      combined[name] = [
        ...(Array.isArray(existing) ? existing : []),
        ...definition,
      ];
    }
  }
  return combined;
}

/**
 * Parses an element's `permissions` attribute — the shared spec
 * mini-language, e.g. `permissions="write:admin, delete:admin|creator"`.
 */
export function parsePermissionsAttribute(value: string): PermissionActionSpec {
  return parsePermissionsSpec(value);
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

  for (const rule of state.clientRules) {
    const matches = element
      ? safeMatches(element, rule.match) ||
        (elementId !== null && matchesRulePattern(rule.match, elementId))
      : elementId !== null && matchesRulePattern(rule.match, elementId);
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

function safeMatches(element: HTMLElement, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Options for can(): identify the targeted entry for "creator" rules. */
export interface CanOptions {
  /** The entry's recorded creator pid… */
  creator?: string;
  /** …or just pass the entry itself; its `createdBy` is read. */
  entry?: unknown;
}

/**
 * Synchronous permission check against the resolved-role cache. This is UX
 * gating: it never blocks an attacker (the server does), but it's what UIs
 * and setData use to decide affordances and local writes.
 *
 * For "creator"-scoped collection rules, pass the targeted entry (or its
 * recorded creator pid) via options so the check can compare ownership.
 */
export function can(
  action: PermissionAction,
  target: HTMLElement | string,
  options: CanOptions = {},
): boolean {
  const { element, elementId } = resolveTarget(target);
  const required = requiredRolesForTarget(action, element, elementId);
  if (required === null) return true;

  const pid = state.identity?.publicKey;
  const creator =
    options.creator ??
    (typeof options.entry === "object" && options.entry !== null
      ? ((options.entry as { createdBy?: unknown }).createdBy as string | undefined)
      : undefined);
  const principal = {
    pid,
    verified: state.verified,
    counters: state.counters,
    isCreator: creator !== undefined && creator === pid,
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
  for (const rule of state.clientRules) {
    if (
      safeMatches(element, rule.match) ||
      matchesRulePattern(rule.match, elementId)
    ) {
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
