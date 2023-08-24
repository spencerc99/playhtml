# playhtml 🛝🌐

_interactive, collaborative html elements with a single data attribute_

playhtml is a library for magically creating collaborative interactive HTML elements that persist their state across sessions. For example, you can create a movable piece of HTML "furniture" by adding the `can-move` attribute:

```html
<div id="couch" can-move style="font-size: 80px">🛋</div>
```

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
  <script type="module">
    import "https://unpkg.com/playhtml";
    playhtml.init();
    // Optionally you could customize the room and host, like so:
    // playhtml.init({
    //  room: window.location.pathname,
    //  host: "mypartykit.user.partykit.dev"
    // })
  </script>
  <link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
</body>
```

If you have dynamic elements that are hydrated after the initial load, you can call `playhtml.setupPlayElement(element)` to imbue the element with playhtml properties.

```html
<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml";
  const newPlayElement = document.createElement("div");
  newPlayElement.id = "newPlayElement";
  playhtml.setupPlayElement(newPlayElement);
</script>
```

To create your own custom element, refer to the [can-play](#can-play) section.

If you're trying this out and having trouble, please message me ([email](mailto:spencerc99@gmail.com), [twitter](https://twitter.com/spencerc99)) and I'm happy to help out!

## Examples

Check out the [full gallery of community examples](https://coda.io/@spencer/playhtml) for more inspiration on what you can do! And [submit your own](https://coda.io/form/playhtml-example_dnUR7xNE7wz) once you've made one.

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
  let candle = document.getElementById("customCandle");
  candle.defaultData = true;
  candle.onClick = (_e, { data, setData }) => {
    setData(!data);
  };
  candle.updateElement = ({ data }) => {
    candle.src = data ? "/candle-gif.gif" : "/candle-off.png";
  };
  candle.resetShortcut = "shiftKey";
  customCandle.defaultData = true;
  customCandle.onClick = (_e, { data, setData }) => {
    setData(!data);
  };
  // The above statement could also be done using the `additionalSetup`
  // which can initialize several different event listeners and custom logic.
  // customCandle.additionalSetup = ({ getData, setData }) => {
  //   customCandle.addEventListener("click", (_e) => {
  //     const data = getData();
  //     setData(!data);
  //   });
  // };
</script>

<!-- Import playhtml -->
<script type="module">
  import "https://unpkg.com/playhtml";
  playhtml.init();
</script>
<link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
```

See all supported properties in the `ElementInitializer` [object in `types.ts`](https://github.com/spencerc99/playhtml/blob/main/src/types.ts#L13).

The only required properties are `defaultData`, `updateElement` and some kind of setup to trigger those functions (in this case, `onClick`, but you can add custom event listeners and logic using the `additionalSetup` property). See more examples based on the definitions for the included capabilities in [`elements.ts`](https://github.com/spencerc99/playhtml/blob/main/src/elements.ts#L72).

If you make something fun, please show me! This is designed as an open library for anyone to add on new interactions and capabilities, so we [welcome contributions](https://github.com/spencerc99/playhtml/blob/main/CONTRIBUTING.md) for new built-in capabilities.

## Plug-and-play Capabilities

These capabilities are common ones that have been designed and created by the community. You should expect that they are relatively well-tested, and they simply build on top of the same API and constructs that `can-play` uses.

### `can-move`

https://github.com/spencerc99/playhtml/assets/14796580/9c2b9bf6-142c-41e2-8c8f-93a3b121a73e

Creates a movable element using 2D `translate` on the element. Dragging the element around will move it

**troubleshooting**

- This currently doesn't work on `inline` display elements.
- This currently doesn't work on touch screens.

### `can-toggle`

<blockquote class="twitter-tweet"><p lang="en" dir="ltr">today i installed some lamps on the demos-and-chill website<br><br>then <a href="https://twitter.com/_jzhao?ref_src=twsrc%5Etfw">@_jzhao</a> and i fought on whether to keep them on or not. <a href="https://t.co/sCspTwmRpS">pic.twitter.com/sCspTwmRpS</a></p>&mdash; spencer chang ☀️ (spencerchang.me @ bsky) (@spencerc99) <a href="https://twitter.com/spencerc99/status/1681048824884895744?ref_src=twsrc%5Etfw">July 17, 2023</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

Creates an element that can be switched on and off. Clicking the element will toggle the `clicked` class on the element.

### `can-duplicate`

Creates an element that duplicates a target element (specified by the value of the `can-duplicate` attribute, which can be an element's ID or custom CSS selector) when clicked. Optionally can specify where the duplicate element is inserted in the DOM via the `can-duplicate-to` setting (default is as a sibling to the original element).

### `can-grow`

Creates an element that can be resized using a `scale` `transform`. Clicking the element will grow it, clicking with <kbd>ALT</kbd> will shrink it. Currently, the max size is 2x the original size and the min size is 1/2 the original size.

### `can-spin`

Creates a rotatable element using a `rotate` `transform` on the element. Dragging the element to the left or right will rotate it counter-clockwise and clockwise respectively.

### `can-post`

![image](https://github.com/spencerc99/playhtml/assets/14796580/6de3fcab-2372-4080-b46f-cd768f1ed44e)

Creates a communal forum from a `form` element. The form will sync any new submissions including all the `input` elements in the form, using their `name` property as the key and their value as the value. New messages will be currently prepended to the element with the `guestbookMessages` ID. TODO: make this generic and take user input

## Contributing

See [CONTRIBUTING.md](https://github.com/spencerc99/playhtml/blob/main/CONTRIBUTING.md).

## Support & Maintenance

Thank you for considering reading this little README and browing this project! I'd love to see you share the library and what you've made with it to me and with your friends. And if you enjoy using this, please consider [sponsoring the project or sending a small donation](https://github.com/sponsors/spencerc99). This helps ensure that the library is maintained and improved over time and funds the hosting costs for the syncing and persistence services.
