# @playhtml/react

A react provider for [`playhtml`](https://github.com/spencerc99/playhtml).

`@playhtml/react` gives you a hooks-like interface for creating realt-ime interactive and persistent elements. It manages all the state syncing for you, so you can reactively render your component based on whatever data is coming in.

Install by using your preferred package manager

```bash
npm install @playhtml/react # or
# yarn add @playhtml/react
```

## Usage

First, wrap your app in the `PlayProvider` component. This will handling initializing the `playhtml` client and setting up the connection to the server. You can specify the same `initOptions` to `PlayProvider` as you would when initializing the client directly.

```tsx
import { PlayProvider } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider
      initOptions={{
        room: "my-room", // the namespace for syncing and storage set to `window.location.pathname + window.location.search`` by default
        host: "mypartykit.user.partykit.dev", // if you want to self-host your own partykit server for extra server-side configuration and security guarantees.
      }}
    >
      {/* rest of your app... */}
    </PlayProvider>
  );
}
```

Then, use the `CanPlayElement` component to render a component with real-time data syncing and persistence capabilities. `CanPlayElement` takes a `defaultData` prop that is used to initialize the data for the element, and accepts a callback for its `children` with the syncing data.

For example, to create a candle that switches between on and off states (designated by separate images), you can use the following code:

```tsx
// candle
export function Candle() {
  return (
    <CanPlayElement defaultData={{ on: false }}>
      {({ data, setData }) => (
        <img
          src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
          selector-id=".candle"
          className="candle"
          onClick={() => setData(!data.on)}
        />
      )}
    </CanPlayElement>
  );
}
```

A more complex example uses `awareness` to show the number of people on the page and their associated color:

```tsx
export function OnlineIndicator() {
  return (
    <CanPlayElement
      defaultData={{}}
      myDefaultAwareness={"#008000"}
      id="online-indicator"
    >
      {({ myAwareness, setMyAwareness, awareness }) => {
        const myAwarenessIdx = myAwareness
          ? awareness.indexOf(myAwareness)
          : -1;
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
      }}
    </CanPlayElement>
  );
}
```

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
