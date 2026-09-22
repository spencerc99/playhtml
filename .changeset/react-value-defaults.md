---
"@playhtml/react": major
---

React `defaultData`, `live`, and `myDefaultAwareness` now accept values only. DOM-dependent callbacks are rejected with a migration message, so child render functions receive supplied defaults on their first render. Replace `defaultData={element => ...}` with a value computed from React props, or use `withSharedState(props => ({ defaultData: ... }), render)`. The vanilla element API still supports DOM-dependent default functions.
