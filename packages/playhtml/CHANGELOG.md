# Change Log

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## 2.1.6 - 2024-04-17

- fix bug with native image dragging conflicting with playhtml draggable elements.

## 2.1.2 - 2024-01-30

- align dependencies

## 2.1.1 - 2024-01-30

- added an `init.js` file export which can be imported to auto-initialize with default settings. Designed to be simplest way to get started with playhtml.

## 2.1.0 - 2024-01-27

- **NEW FEATURE** Added eventing support for imperative logic like showing confetti whenever someone clicks a button which don't depend on a reacting to a data value changing. See the README under "eventing" for more details on how to set this up.
- **BREAKING CHANGE** Changed the hash function used to generate element ids to be a stable length for long-term scalability. This will cause all elements without an `id` to be re-created to lose any persistent historical data. This was done to avoid duplicates and to swap to using a standard-length hash function (SHA-1). We still recommend you setting a unique `id` for each element to avoid any potential duplicates in the future, and using `selectorId` will not be affected by this change.

## 2.0.16 - 2024-01-04

- **BREAKING CHANGE** deprecated using non-object values as `defaultData` for elements. If you were using a single value before, instead, use an object with a `value` key. e.g. `defaultData: { value: "my value" }`. This allows for easier extension of the data in the future.
- **BREAKING CHANGE** deprecated `playhtml.init()` automatically being called to avoid side-effects upon import. This has been replaced with a new `init` file that you can directly import if you'd like to auto-initialize without any settings. See the README for more details.
- exported `setupPlayElements` to call to look for any new elements to initialize

## 2.0.7 - 2023-10-02

- upgrading y-partykit and yjs to latest for improved performance

## 2.0.5 - 2023-09-11

- fixed an error with setting up elements before the provider was synced which lead to incorrect initial element states that didn't sync.
- Removed the `firstSetup` export accordingly to allow for optimistically setting up elements even before `playhtml` is initialized.
- Added `removePlayElement` to handle removing upon unmounting or removal of an element from the DOM to clear up the state.

## 2.0.4 - 2023-09-07

- added @playhtml/react library
- added `firstSetup` export from playhtml for raising error if it hasn't been initialized.
- cleaned up exports

## 2.0.2 - 2023-08-23

- handle deprecated import version by using a timeout. This adds a significant delay to the initialization of any client using the old method and logs a warning.

## 2.0.0 - 2023-08-23

- **BREAKING CHANGE**: Changed the initializing of playhtml to be an explicit call of `playhtml.init()` from just a normal import. You can still use the old code if you pin the import to any version 1.3.1 (e.g. use `https://unpkg.com/playhtml@1.3.1` as the import source).

**OLD CODE:**

```html
<script type="module" src="https://unpkg.com/playhtml"></script>
<link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
```

**NEW CODE:**

```html
<script type="module">
  import "https://unpkg.com/playhtml";
  playhtml.init();
  // Optionally you could call
  // playhtml.init({
  //  room: window.location.pathname,
  //  host: "mypartykit.user.partykit.dev"
  // })
</script>
<link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
```

This change allows for more flexible use of the package, including specifying a partykit host and room.

- was accidentally importing all my files for the website into the package, blowing it up to 4MB. I've fixed this and compressed down the `.d.ts` types file to just what is needed, so the package is down to 360KB. It should load much faster on websites now :)

## 1.3.1 - 2023-08-09

- Removed unused code and consolidated types in `types.ts`

## 1.3.0 - 2023-08-07

- Added support for `can-duplicate` capability to duplicate elements. Make factories for playhtml elements!!

## 1.2.0 - 2023-08-03

- Added support for yjs's `awareness` protocol to handle synced data that shouldn't be persisted.
