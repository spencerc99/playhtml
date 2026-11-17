---
"@playhtml/react": patch
---

Installing `@playhtml/react` no longer pulls in its own copy of React. It uses the `react` and `react-dom` already in your app, so you no longer risk two copies of React and "Invalid hook call" errors. The supported range is now React 18.2 and up (including React 19), which matches what the package already needed: it uses `useId`, which React 16 and 17 do not have.
