// ABOUTME: Dev-only Agentation feedback toolbar for leaving comments on docs pages
// ABOUTME: Lazy-loaded so the package never lands in the production bundle
import { lazy, Suspense } from "react";

const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : null;

export function AgentationDevToolbar() {
  if (!Agentation) return null;
  return (
    <Suspense fallback={null}>
      <Agentation />
    </Suspense>
  );
}
