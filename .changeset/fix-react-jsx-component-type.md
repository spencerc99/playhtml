---
"@playhtml/react": patch
---

Fix JSX component type error in withSharedState. Changed component return type from ReactElement to ReactNode and withSharedState return type to React.ComponentType for proper JSX compatibility.