# Image placeholders

Drop real images into this folder using the exact filenames referenced in the docs. To find every use, run:

```bash
rg "TODO-IMAGE" apps/docs
```

Expected filenames (reference paths in docs: `/placeholders/<filename>`):

| File | Subject | Used on |
|---|---|---|
| `hat-cat-box.jpg` | Scene: a hat and a cat (plush or drawing) inside a visible box/frame | Capabilities — `can-move` |
| `fiddle-leaf.jpg` | A fiddle-leaf fig plant in a pot, plain backdrop | Capabilities — `can-grow` |
| `bicycle-wheel.jpg` | A bicycle wheel, ideally head-on | Capabilities — `can-spin` |
| `pixel-rabbit.png` | A pixel-art rabbit (prefer transparent PNG, ~96×96) | Capabilities — `can-duplicate` |

Until the real files are dropped in, pages render a light-gray placeholder box with the subject name centered. See `.ph-media-placeholder` in `apps/docs/src/styles/docs-extras.css`.
