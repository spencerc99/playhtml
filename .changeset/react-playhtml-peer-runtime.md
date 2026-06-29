---
"@playhtml/react": patch
"playhtml": patch
---

Keep the React bindings connected to the app-provided playhtml runtime so package managers do not install a separate nested playhtml client for React wrappers, and expose the shared React-facing API through playhtml so React consumers only depend on one compatibility boundary.
