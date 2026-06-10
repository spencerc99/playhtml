// ABOUTME: Verifies client-side permission gating: can() resolution across attribute,
// ABOUTME: init-config, and server-published rules, plus identity/verification reactivity.
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  configurePermissions,
  can,
  getMe,
  setIdentity,
  setVerified,
  setServerPermissionsStatus,
  isServerGated,
  isLocallyGated,
  parsePermissionsAttribute,
  __resetPermissionsForTests,
  IDENTITY_CHANGE_EVENT,
} from "../auth/permissions";
import type { PlayerIdentity } from "@playhtml/common";

const ADMIN_PK = "pk_" + "aa".repeat(65);
const OTHER_PK = "pk_" + "bb".repeat(65);

function identity(pid: string, name?: string): PlayerIdentity {
  return {
    publicKey: pid,
    name,
    playerStyle: { colorPalette: ["hsl(1, 70%, 60%)"] },
    source: "local",
  };
}

function makeElement(id: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  __resetPermissionsForTests();
  document.body.innerHTML = "";
});

describe("parsePermissionsAttribute", () => {
  it("parses action:role pairs with | alternatives", () => {
    expect(parsePermissionsAttribute("write:admin, delete:admin|creator")).toEqual({
      write: "admin",
      delete: ["admin", "creator"],
    });
  });

  it("ignores unknown actions and malformed entries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parsePermissionsAttribute("fly:admin, write:")).toEqual({});
    warn.mockRestore();
  });
});

describe("can()", () => {
  it("allows everything when no rules apply", () => {
    const el = makeElement("free");
    expect(can("write", el)).toBe(true);
    expect(can("write", "#missing")).toBe(true);
  });

  it("gates via the permissions attribute against config roles", () => {
    configurePermissions({ roles: { admin: [ADMIN_PK] } });
    const el = makeElement("title", { permissions: "write:admin" });

    setIdentity(identity(OTHER_PK));
    expect(can("write", el)).toBe(false);

    setIdentity(identity(ADMIN_PK));
    expect(can("write", el)).toBe(true);
  });

  it("gates via init-config rules with CSS selectors", () => {
    configurePermissions({
      roles: { admin: [ADMIN_PK] },
      rules: [{ match: "[data-locked]", write: "admin" }],
    });
    const el = makeElement("anything", { "data-locked": "" });
    setIdentity(identity(OTHER_PK));
    expect(can("write", el)).toBe(false);
    setIdentity(identity(ADMIN_PK));
    expect(can("write", el)).toBe(true);
  });

  it("supports condition-function roles (client-only)", () => {
    configurePermissions({
      roles: { regular: ({ name }) => name === "spencer" },
      rules: [{ match: "wall", write: "regular" }],
    });
    const el = makeElement("wall");
    setIdentity(identity(OTHER_PK, "visitor"));
    expect(can("write", el)).toBe(false);
    setIdentity(identity(OTHER_PK, "spencer"));
    expect(can("write", el)).toBe(true);
  });

  it("supports built-in verified and creator roles", () => {
    configurePermissions({
      rules: [
        { match: "board", write: "verified" },
        { match: "notes", update: "creator" },
      ],
    });
    const board = makeElement("board");
    const notes = makeElement("notes");
    setIdentity(identity(OTHER_PK));

    expect(can("write", board)).toBe(false);
    setVerified(true);
    expect(can("write", board)).toBe(true);

    expect(can("update", notes, { creator: OTHER_PK })).toBe(true);
    expect(can("update", notes, { creator: ADMIN_PK })).toBe(false);
    // entry-level rule doesn't gate element-level write
    expect(can("write", notes)).toBe(true);
  });

  it("uses server-published rules when present", () => {
    setIdentity(identity(OTHER_PK));
    setServerPermissionsStatus({
      type: "permissions_status",
      enforced: true,
      roles: { admin: [ADMIN_PK] },
      rules: [{ match: "title", write: "admin" }],
      roomPath: "/wall",
    });
    expect(can("write", "#title")).toBe(false);
    setIdentity(identity(ADMIN_PK));
    expect(can("write", "#title")).toBe(true);
  });
});

describe("server gating + local gating detection", () => {
  it("isServerGated only when enforced server rules match", () => {
    expect(isServerGated("title")).toBe(false);
    setServerPermissionsStatus({
      type: "permissions_status",
      enforced: true,
      roles: {},
      rules: [{ match: "note-*", update: "creator" }],
    });
    expect(isServerGated("note-42")).toBe(true);
    expect(isServerGated("other")).toBe(false);
  });

  it("isLocallyGated detects attribute, config-rule, and server-rule gating", () => {
    const free = makeElement("free");
    expect(isLocallyGated(free, "free")).toBe(false);

    const attributed = makeElement("attributed", { permissions: "write:admin" });
    expect(isLocallyGated(attributed, "attributed")).toBe(true);

    configurePermissions({ rules: [{ match: "ruled", write: "admin" }] });
    const ruled = makeElement("ruled");
    expect(isLocallyGated(ruled, "ruled")).toBe(true);
    expect(isLocallyGated(free, "free")).toBe(false);
  });
});

describe("me state + events", () => {
  it("exposes pid/verified/roles and fires identitychange", () => {
    configurePermissions({ roles: { admin: [ADMIN_PK] } });

    const events: string[] = [];
    const listener = () => events.push("identitychange");
    document.addEventListener(IDENTITY_CHANGE_EVENT, listener);

    setIdentity(identity(ADMIN_PK, "spencer"));
    const me = getMe();
    expect(me.pid).toBe(ADMIN_PK);
    expect(me.roles).toContain("admin");
    expect(me.verified).toBe(false);
    expect(me.enforced).toBe(false);

    setVerified(true);
    expect(getMe().verified).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);

    document.removeEventListener(IDENTITY_CHANGE_EVENT, listener);
  });
});
