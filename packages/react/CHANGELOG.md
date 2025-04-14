# Change Log

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## 0.4.1 - 2025-04-14

### Breaking Changes

- **REMOVED API** Completely removed the deprecated `withPlay` function. Use `withSharedState` instead (see migration guide in 0.3.1 release notes below).

### Enhancements

- **ENHANCEMENT** Added support for React 19
- Updated peerDependencies to include React 19
- Updated TypeScript definitions to support React 19
- Improvements to provider detection & handling island architectures like Astro
  - Added standalone mode functionality to eliminate the requirement for a PlayProvider wrapper
  - Enhanced provider detection with clearer error messages when a provider is missing

## 0.3.1 - 2024-02-17

- **NEW API** Replaced the main api `withPlay` with `withSharedState` to make it more functionally clear what it does. This new API also is much cleaner because it removes the need to curry the function. The old `withPlay` API is still available for backwards compatibility but will be removed in the next major version. See some examples below for the comparison:

**old api**

```tsx
export const ToggleSquare = withPlay<Props>()(
  { defaultData: { on: false } },
  ({ data, setData, ...props }) => {
    return (
      <div
        style={{
          width: "200px",
          height: "200px",
          ...(data.on ? { background: "green" } : { background: "red" }),
        }}
        onClick={() => setData({ on: !data.on })}
      />
    );
  }
);
```

**new api**

```tsx
export const ToggleSquare = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }, props: Props) => {
    return (
      <div
        style={{
          width: "200px",
          height: "200px",
          ...(data.on ? { background: "green" } : { background: "red" }),
        }}
        onClick={() => setData({ on: !data.on })}
      />
    );
  }
);
```

## 0.2.0 - 2024-01-27

- **NEW FEATURE** Added eventing support for imperative logic like showing confetti whenever someone clicks a button which don't depend on a reacting to a data value changing. See the README under "eventing" for more details on how to set this up.`

## 0.1.0

- works with more complex state
- allows for setting data inside your render function
- passes ref into render function for accessing the component information / imperatively acting on it
- handles passing in fragments and multiple children into render function
- works with Next.JS and examples

## 0.0.12 - 2023-09-11

- works when changing props

## 0.0.11 - 2023-09-11

- ok confirmed working now and handles unmount

## 0.0.2 - 2023-09-07

- basic react support!
