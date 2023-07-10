# playhtml 🛝🌐

_interactive, collaborative html elements with a single data attribute_

playhtml is a library for magically creating collaborative interactive HTML elements that persist their state across sessions. For example, you can create a movable piece of HTML "furniture" by adding the `can-move` attribute:

```html
<div can-move style="font-size: 80px">🛋</div>
```

This is designed as an open library for anyone to add on new interactions and capabilities. To get started, see the [New Capabilities](#new-capabilities).

<video width="480" height="360" controls>
  <source src="./demo.mov" type="video/mp4">
</video>

## Usage

To use this library, you can import the library and the associated styles from a CDN (in this case we will use [unpkg.com](https://unpkg.com)). Please make sure to do this after all the HTML elements on the page.

```html
<body>
  <!-- ... html elements here -->
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

TODO: add import for React.

## New Capabilities

`playhtml` is designed to be a collective library of magical capabilities that anyone can attach to arbitrary HTML elements. If you have an idea for a new capability, please first ensure that there is not a duplicate existing one in the current library (see `TagType` in `types.ts`). Please make a proposal for the capability you would like to add by opening an issue with the `new-capability` label.

To contribute your capability, see sample PR (TODO: LINK).

## Contributing

Outside of contributing new capabilities, feel free to submit any issues or PRs for bugs or improvements to the core of the library.

## Support & Maintenance

If you enjoy the idea of this library or like using it, please consider [sponsoring the project](https://github.com/sponsors/spencerc99). This will help ensure that the library is maintained and improved over time.
