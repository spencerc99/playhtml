// ABOUTME: Wraps a React recipe component in a runnable App with PlayProvider and page styles.
// ABOUTME: Keeps the shell identical across the docs-demo recipes so only the component differs.
import { indent } from "../recipe-document";

const pageStyles = `:root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; }
#root { display: grid; min-height: 100vh; padding: 1.5rem; place-items: center; }`;

/** The `App` export that renders `component` inside a PlayProvider. */
export function appShell(component: string, css: string): string {
  return `export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <${component} />
      </main>

      <style>{\`
${indent(`${pageStyles}\n${css}`, 8)}
      \`}</style>
    </PlayProvider>
  );
}`;
}
