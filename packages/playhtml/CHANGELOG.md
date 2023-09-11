# Change Log

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## 2.0.5 - 2023-09-11

- fixed an error with setting up elements before the provider was synced which lead to incorrect initial element states that didn't sync.
- Removed the `firstSetup` export accordingly to allow for optimistically setting up elements even before `playhtml` is initialized.

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
