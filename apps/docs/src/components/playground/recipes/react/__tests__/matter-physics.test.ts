// ABOUTME: Verifies the copy-paste React Matter.js recipe parses and preserves sync boundaries.
// ABOUTME: Guards its provider, stable element, controller, and throttled keyed writes.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { matterPhysicsReactSource } from "../matter-physics";

describe("React Matter.js physics source", () => {
  it("is a syntactically valid, complete App.tsx snippet", () => {
    const result = ts.transpileModule(matterPhysicsReactSource, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );

    expect(errors).toEqual([]);
    expect(matterPhysicsReactSource).toContain(
      'from "@playhtml/react"',
    );
    expect(matterPhysicsReactSource).toContain("<PlayProvider");
    expect(matterPhysicsReactSource).toContain(
      'id: "shared-physics-world"',
    );
    expect(matterPhysicsReactSource).toContain(
      'id="shared-physics-world"',
    );
  });

  it("keeps one controller and throttles bounded keyed writes", () => {
    expect(matterPhysicsReactSource).toContain(
      "const SYNC_INTERVAL_MS = 100;",
    );
    expect(matterPhysicsReactSource).toContain(
      "draft.controllerId !== clientIdRef.current",
    );
    expect(matterPhysicsReactSource).toContain(
      "draft.bodies[id].x = transform.x;",
    );
    expect(matterPhysicsReactSource).toContain(
      "Math.min(WORLD_WIDTH - BODY_SIZE / 2",
    );
    expect(matterPhysicsReactSource).toContain(
      "interpolateRemoteBodies();",
    );
  });

  it("writes from controls or the authority animation callback", () => {
    const reconcileStart = matterPhysicsReactSource.indexOf(
      "useEffect(() => {\n      const sharedIds",
    );
    const controllerEffectStart = matterPhysicsReactSource.indexOf(
      "useEffect(() => {\n      setControlMode",
    );
    const animationEffectStart = matterPhysicsReactSource.indexOf(
      "useEffect(() => {\n      let animationFrame",
    );
    const renderStart = matterPhysicsReactSource.indexOf(
      "const controlsWorld =",
    );

    expect(reconcileStart).toBeGreaterThan(-1);
    expect(controllerEffectStart).toBeGreaterThan(reconcileStart);
    expect(animationEffectStart).toBeGreaterThan(controllerEffectStart);
    expect(renderStart).toBeGreaterThan(animationEffectStart);
    expect(
      matterPhysicsReactSource.slice(reconcileStart, controllerEffectStart),
    ).not.toContain("setData(");
    expect(
      matterPhysicsReactSource.slice(animationEffectStart, renderStart),
    ).not.toContain("setData(");
  });
});
