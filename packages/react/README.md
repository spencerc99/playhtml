# @playhtml/react

A react provider for [`playhtml`](https://github.com/spencerc99/playhtml).

`@playhtml/react` provides components out of the box corresponding to each of the capabilities. It manages all the state syncing for you, so you can reactively render your component based on whatever data is coming in.

Install by using your preferred package manager

```bash
npm install @playhtml/react # or
# yarn add @playhtml/react
```

The callback handlers are slightly different to match the reactive patterns of React. For example, instead of `updateElement`, which is a vanilla javascript recreation of a reactive state management system, you can simply use your own state hooks or call `setData` to modify the shared state.

You must import `playhtml` from the package and call `playhtml.init` somewhere before your components are rendered. This can be done anywhere in the code (unless you are using a framework with Server-Side Rendering, SSR, like with Next.JS, see below for how to handle this).

```tsx
// candle
playhtml.init();
export function Candle() {
  return (
    <CanPlayElement
      defaultData={{ on: false }}
      onClick={(_e, { data, setData }) => {
        setData({ on: !data.on });
      }}
    >
      {({ data }) => (
        <img
          src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
          selector-id=".candle"
          className="candle"
        />
      )}
    </CanPlayElement>
  );
}
```

Refer to `packages/react/example.tsx` for a full list of examples.

**next.js**
Handling Next is more difficult due to the browser-first nature of `playhtml` and how you have to handle the same code running server-side with Next.

To initialize `playhtml`, you'll need to dynamically import `playhtml` and call init in a `useEffect` in the top-level component.

```tsx
async function initPlayhtml() {
  const playhtml = (await import("@playhtml/react")).playhtml;

  playhtml.init();
}
// ... my component
useEffect(() => {
  void initPlayhtml();
});
```

Then, in your components, you'll need to turn off `ssr` for dynamically importing the `playhtml` elements.

```tsx
import type { CanPlayElement as CanPlayElementType } from "@playhtml/react";
import dynamic from "next/dynamic";
const CanPlayElement = dynamic(
  () => import("@playhtml/react").then((c) => c.CanPlayElement),
  { ssr: false }
) as typeof CanPlayElementType;
```
