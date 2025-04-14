# @playhtml/react

A react provider for [`playhtml`](https://github.com/spencerc99/playhtml).

`@playhtml/react` gives you a hooks-like interface for creating realt-ime interactive and persistent elements. It manages all the state syncing for you, so you can reactively render your component based on whatever data is coming in.

Install by using your preferred package manager

```bash
npm install @playhtml/react # or
# yarn add @playhtml/react
```

## Compatibility

`@playhtml/react` is compatible with React versions 16.8.0 and above, including React 17, React 18, and React 19.

## Usage

First, wrap your app in the `PlayProvider` component. This will handling initializing the `playhtml` client and setting up the connection to the server. You can specify the same `initOptions` to `PlayProvider` as you would when initializing the client directly.

```tsx
import { PlayProvider } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider
      initOptions={
        {
          // room: "my-room", // the namespace for syncing and storage set to `window.location.pathname + window.location.search`` by default
          // host: "mypartykit.user.partykit.dev", // if you want to self-host your own partykit server for extra server-side configuration and security guarantees.
        }
      }
    >
      {/* rest of your app... */}
    </PlayProvider>
  );
}
```

Then, use `withSharedState` to wrap your components in a higher order component to enhance them with live, shared data. `withSharedState` takes in a `defaultData` along with other configuration and a norma functional component definition, to which it will pass through the data and a callback to change that data `setData`.

For example, to create a rectangle that switches between on and off states (designated by the background), you can use the following code:

```tsx
import { withSharedState } from "@playhtml/react";
interface Props {}

export const ToggleSquare = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }, props: Props) => {
    return (
      <div
        style={{
          ...(data.on ? { background: "green" } : { background: "red" }),
        }}
        onClick={() => setData({ on: !data.on })}
      />
    );
  }
);
```

https://github.com/spencerc99/playhtml/assets/14796580/beff368e-b659-4db0-b314-16d10b09c31f

A more complex example uses `awareness` to show the number of people on the page and their associated color:

```tsx
export const OnlineIndicator = withSharedState(
  { defaultData: {}, myDefaultAwareness: "#008000", id: "online-indicator" },
  ({ myAwareness, setMyAwareness, awareness }) => {
    const myAwarenessIdx = myAwareness ? awareness.indexOf(myAwareness) : -1;
    return (
      <>
        {awareness.map((val, idx) => (
          <div
            key={idx}
            style={{
              width: "50px",
              height: "50px",
              borderRadius: "50%",
              background: val,
              boxShadow:
                idx === myAwarenessIdx
                  ? "0px 0px 30px 10px rgb(245, 169, 15)"
                  : undefined,
            }}
          ></div>
        ))}
        <input
          type="color"
          onChange={(e) => setMyAwareness(e.target.value)}
          value={myAwareness}
        />
      </>
    );
  }
);
```

![image](https://github.com/spencerc99/playhtml/assets/14796580/37b75f82-7a09-4a35-8794-3003425726f5)

If you need access to the element's custom props for creating the configuration, you can just pass a callback that returns the configuration object:

```tsx
interface Reaction {
  emoji: string;
  count: number;
}

export const ReactionView = withSharedState(
  ({ reaction: { count } }) => ({
    defaultData: { count },
  }),
  ({ data, setData, ref }, props: { reaction: Reaction }) => {
    const {
      reaction: { emoji },
    } = props;
    const [hasReacted, setHasReacted] = useState(false);

    useEffect(() => {
      if (ref.current) {
        setHasReacted(Boolean(localStorage.getItem(ref.current.id)));
      }
    }, [ref.current?.id]);

    return (
      <button
        onClick={(_e) => {
          const { count } = data;
          if (hasReacted) {
            setData({ count: count - 1 });
            if (ref.current) {
              localStorage.removeItem(ref.current.id);
            }
            setHasReacted(false);
          } else {
            setData({ count: count + 1 });
            if (ref.current) {
              localStorage.setItem(ref.current.id, "true");
            }
            setHasReacted(true);
          }
        }}
        className={`reaction ${hasReacted ? "reacted" : ""}`}
        selector-id=".reactions reaction"
      >
        {emoji} <span className="count">{data.count}</span>
      </button>
    );
  }
);
```

### Examples

You can find plenty of examples under `packages/react/examples` to see how to use `@playhtml/react` in a variety of ways. Live examples can also be found at https://playhtml.fun/experiments/one/ and https://playhtml.fun/experiments/two/ (all located inside the repo).

### Eventing

You can set up imperative logic that doesn't depend on a data value changing (like triggering confetti when someone clicks in an area) by registering events with playhtml. You can either pass in a list of events to `PlayProvider` or you can call `playhtml.registerPlayEventListener` to register an event at any time.

An example on a hook that returns a callback to trigger shared confetti (from `packages/react/examples/Confetti.tsx`):

```tsx
import React from "react";
import { PlayContext } from "@playhtml/react";
import { useContext, useEffect } from "react";

const ConfettiEventType = "confetti";

export function useConfetti() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = useContext(PlayContext);

  useEffect(() => {
    const id = registerPlayEventListener(ConfettiEventType, {
      onEvent: () => {
        // requires importing <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>
        // somewhere in your app
        window.confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
      },
    });

    return () => removePlayEventListener(ConfettiEventType, id);
  }, []);

  return () => {
    dispatchPlayEvent({ type: ConfettiEventType });
  };
}

// Usage
export function ConfettiZone() {
  const triggerConfetti = useConfetti();

  return (
    <div
      style={{ width: "400px", height: "400px", border: "1px red solid" }}
      id="confettiZone"
      onClick={() => triggerConfetti()}
    >
      <h1>CONFETTI ZONE</h1>
    </div>
  );
}
```

https://github.com/spencerc99/playhtml/assets/14796580/bd8ecfaf-73ab-4aa2-9312-8917809f52a2

For full configuration, see the interface below.

```tsx
interface CanPlayElementProps<T extends object, V extends object> {
  id?: string; // the id of this element, required if the top-level child is a React Fragment. Defaults to the id of the top-level child or a hash of the contents of the children if not specified.
  defaultData: T; // the default data for this element
  myDefaultAwareness?: V; // the default awareness for this element
  children: (props: ReactElementEventHandlerData<T, V>) => React.ReactNode;
}

// callback props
interface ReactElementEventHandlerData<T extends object, V extends object> {
  data: T; // the data for this element
  setData: (data: T) => void; // sets the data for this element
  awareness: V[]; // the awareness values of all clients (including self)
  myAwareness?: V; // the specific awareness of this client
  setMyAwareness: (data: V) => void; // sets "myAwareness" to the given value and syncs it to other clients
}
```

Refer to `packages/react/example.tsx` for a full list of examples.

## Open considerations

- how to best handle configuring how persistence works? (e.g. none vs. locally vs. globally)?
  - Currently the separate configurations are managed by housing the data in completely separate stores and function abstractions. `setAwareness` is used for no persistence, there is no configuration for only local persistence, and `setData` persists the data globally.
  - Maybe this would be better if it was a per-data-key configuration option? Likely a `persistenceOptions` object with an enum value for `none`, `local`, and `global` for each key. It wouldn't allow for nested configuration.
- `awareness` should probably be separated into `myAwareness` and `othersAwareness`.
- is it more ergonomic to make a hooks-esque interface and use some sort of callback from `PlayProvider` to get/set data? Hard to do this without requiring the user to specify some "id" for the data though.
