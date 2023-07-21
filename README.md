# playhtml 🛝🌐

_interactive, collaborative html elements with a single data attribute_

playhtml is a library for magically creating collaborative interactive HTML elements that persist their state across sessions. For example, you can create a movable piece of HTML "furniture" by adding the `can-move` attribute:

```html
<div id="couch" can-move style="font-size: 80px">🛋</div>
```

This is designed as an open library for anyone to add on new interactions and capabilities. To get started, see the [New Capabilities](#new-capabilities).

https://github.com/spencerc99/playhtml/assets/14796580/00e84e15-2c1c-4b4b-8e15-2af22f39db7a

If you enjoy this, please consider [sponsoring the project or sending a small donation](https://github.com/sponsors/spencerc99). This helps ensure that the library is maintained and improved over time and funds the hosting costs for the syncing and persistence services.

## Usage

To use this library, you can import the library and the associated styles from a CDN (in this case we will use [unpkg.com](https://unpkg.com)). Please make sure to do this after all the HTML elements on the page and ensure that the HTML elements you are "magic-ifying" have an `id` set.

```html
<body>
  <!-- ... html elements here -->
  <!-- valid example -->
  <img
    src="https://media2.giphy.com/media/lL7A3Li0YtFHq/giphy.gif?cid=ecf05e47ah89o71gzz7ke7inrgb1ai1xcbrjnqdf7o890118&ep=v1_stickers_search&rid=giphy.gif"
    can-move
  />
  id="openSign"
  <!-- INVALID EXAMPLE <img src="https://media2.giphy.com/media/lL7A3Li0YtFHq/giphy.gif?cid=ecf05e47ah89o71gzz7ke7inrgb1ai1xcbrjnqdf7o890118&ep=v1_stickers_search&rid=giphy.gif" can-move /> -->
  <!-- import the script -->
  <script type="module" src="https://unpkg.com/playhtml"></script>
  <link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
</body>
```

If you have dynamic elements that are hydrated after the initial load, you can call `playhtml.setupElements()` whenever needed to have the library look for elements that haven't been marked.

```js
<script type="module">
  import {setupElements} from "https://unpkg.com/playhtml"; setupElements();
</script>
```

## Capabilities

A full list can be found in `types.ts` under `TagType`.

## Custom Capabilities

### `can-play`

`can-play` is the fully customizable experience of `playhtml`. You can create anything using simple HTML, CSS, and Javascript by simply adding on the functionality needed to the element itself. The library will handle magically syncing and persisting any data that you store.

Here's the simple example included on the playhtml website:

https://github.com/spencerc99/playhtml/assets/14796580/fae669b1-b3e2-404e-bd7a-3d36b81c572d

```html
<img can-play id="customCandle" src="/candle-gif.gif" />
<!-- IMPORTANT: this data must be set _before_ importing the playhtml library. -->
<script>
  // Every HTML element with an ID has a variable corresponding to that ID name in the global context (see https://stackoverflow.com/questions/3434278/do-dom-tree-elements-with-ids-become-global-properties/3434388#3434388)
  // This is fun, magical, and readable for small projects, but if you have a larger, complex project, I would advise using `document.getElementById` or `document.querySelector`...
  customCandle.defaultData = true;
  customCandle.onClick = (_e, { data, setData }) => {
    setData(!data);
  };
  customCandle.updateElement = ({ data }) => {
    customCandle.src = data ? "/candle-gif.gif" : "/candle-off.png";
  };
  customCandle.resetShortcut = "shiftKey";

  // Alternatively
  // let candle = document.getElementById('customCandle');
  // candle.defaultData = true;
  // candle.onClick = (_e, { data, setData }) => {
  //   setData(!data);
  // };
  // candle.updateElement = ({ data }) => {
  //   candle.src = data ? "/candle-gif.gif" : "/candle-off.png";
  // };
  // candle.resetShortcut = "shiftKey";
</script>

<!-- Import playhtml -->
<script type="module" src="https://unpkg.com/playhtml"></script>
<link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
```

The only required properties are `defaultData`, `updateElement` and some kind of setup to trigger those functions (in this case, `onClick`, but you can add custom event listeners and logic using the `additionalSetup` property). See more examples based on the definitions for the included capabilities in `elements.ts`.

## Plug-and-play Capabilities

These capabilities are common ones that have been designed and created by the community. You should expect that they are relatively well-tested, and they simply build on top of the same API and constructs that `can-play` uses.

We welcome any contributions if you have custom `can-play` elements that you would like to add to the library! Please make a PR.

### `can-move`

https://github.com/spencerc99/playhtml/assets/14796580/9c2b9bf6-142c-41e2-8c8f-93a3b121a73e

Creates a movable object using 2D `translate` on the element. Dragging the element around will move it

**troubleshooting**

- This currently doesn't work on `inline` display elements.
- This currently doesn't work on touch screens.

### `can-spin`

Creates a rotatable object using a `rotate` `transform` on the element. Dragging the element to the left or right will rotate it counter-clockwise and clockwise respectively.

### `can-toggle`

<blockquote class="twitter-tweet"><p lang="en" dir="ltr">today i installed some lamps on the demos-and-chill website<br><br>then <a href="https://twitter.com/_jzhao?ref_src=twsrc%5Etfw">@_jzhao</a> and i fought on whether to keep them on or not. <a href="https://t.co/sCspTwmRpS">pic.twitter.com/sCspTwmRpS</a></p>&mdash; spencer chang ☀️ (spencerchang.me @ bsky) (@spencerc99) <a href="https://twitter.com/spencerc99/status/1681048824884895744?ref_src=twsrc%5Etfw">July 17, 2023</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

Creates an object that can be switched on and off. Clicking the element will toggle the `clicked` class on the element.

### `can-grow`

Creates an object that can be resized using a `scale` `transform`. Clicking the object will grow it, clicking with <kbd>ALT</kbd> will shrink it. Currently, the max size is 2x the original size and the min size is 1/2 the original size.

### `can-post`

![image](https://github.com/spencerc99/playhtml/assets/14796580/6de3fcab-2372-4080-b46f-cd768f1ed44e)

Creates a communal forum from a `form` element. The form will sync any new submissions including all the `input` elements in the form, using their `name` property as the key and their value as the value. New messages will be currently prepended to the element with the `guestbookMessages` ID. TODO: make this generic and take user input

---

To add new ones, please find contributor guidelines in [New Capabilities](#new-capabilities).

## Contributing

### New Capabilities

`playhtml` is designed to be a collective library of magical capabilities that anyone can attach to arbitrary HTML elements. If you have an idea for a new capability, please first ensure that there is not a duplicate existing one in the current library (see `TagType` in `types.ts`). Please make a proposal for the capability you would like to add by opening an issue with the `new-capability` label.

To contribute your capability, see sample PR (TODO: LINK).

---

Outside of contributing new capabilities, feel free to submit any issues or PRs for bugs or improvements to the core of the library.

## Support & Maintenance

Thank you for considering reading this little README and browing this project! I'd love to see you share the library and what you've made with it to me and with your friends. And if you enjoy using this, please consider [sponsoring the project or sending a small donation](https://github.com/sponsors/spencerc99). This helps ensure that the library is maintained and improved over time and funds the hosting costs for the syncing and persistence services.
