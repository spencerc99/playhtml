// @ts-check
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// https://astro.build/config
export default defineConfig({
  base: "/docs",
  outDir: path.resolve(repoRoot, "site-dist/docs"),
  // Shiki's dual-theme mode. Starlight's Expressive Code integration is
  // disabled below, so every fenced ``` block goes through Astro's built-in
  // Shiki pipeline. When we pass `themes: { light, dark }` Shiki emits
  // inline CSS custom properties that flip automatically whenever the
  // ancestor `[data-theme="dark"]` attribute is set (the class Starlight
  // toggles on <html>). If we were to ship a single `theme` string instead,
  // dark-mode readers would see light-mode syntax tokens on a dark backdrop
  // — effectively invisible code. `github-light` reads well on our paper
  // backdrop (`--ph-paper`); `github-dark` matches Starlight's own dark-mode
  // chrome and keeps the same token palette identity (github), so the two
  // modes don't feel like different sites.
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      wrap: false,
    },
  },
  vite: {
    resolve: {
      alias: {
        playhtml: path.resolve(repoRoot, "packages/playhtml/src/index.ts"),
        "@playhtml/react": path.resolve(repoRoot, "packages/react/src/index.tsx"),
        "@playhtml/common": path.resolve(repoRoot, "packages/common/src/index.ts"),
      },
      // The docs app itself doesn't depend on yjs — it's a transitive dep of
      // playhtml. We still ask Vite to dedupe it here because the monorepo can
      // resolve yjs to two distinct paths (root `node_modules/yjs` vs
      // `packages/playhtml/node_modules/yjs`) via bun's hoisting quirks. Two
      // copies → two `Y.Doc` constructors → the "Yjs was already imported"
      // warning → silent sync breakage. The canonical workspace-level fix is
      // the `overrides` block in the root package.json; this is a cheap
      // belt-and-suspenders so local dev still works even if `bun install`
      // hasn't re-run after the override was added.
      dedupe: ["yjs", "y-protocols", "lib0"],
    },
  },
  integrations: [
    starlight({
      title: "playhtml",
      description:
        "Interactive, collaborative HTML elements with a single attribute.",
      // Turn off Expressive Code so every fenced ``` block goes through Astro's
      // own Shiki pipeline, producing a plain `<pre class="astro-code">` that
      // we style ourselves. This unifies visual language: the splash + guide
      // pages used to have a custom `CopyTraceSnippet` wrapper while the rest
      // of the markdown showed EC frames with a different copy button and
      // font stack — two different "copy block" conventions on the same site.
      expressiveCode: false,
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/spencerc99/playhtml",
        },
      ],
      customCss: ["./src/styles/docs-extras.css"],
      components: {
        Head: "./src/components/HeadOverride.astro",
        SocialIcons: "./src/components/SocialIconsWithPresence.astro",
        Footer: "./src/components/FooterWithScrollRail.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        Hero: "./src/components/Hero.astro",
      },
      // Sidebar IA:
      //   Start        → install, "using React" primer, the 4 primitives
      //   Capabilities → every built-in can-* attribute on one page + can-play
      //   Data         → one merged "data essentials" page (shape + setData +
      //                   cleanup), page-level data, presence (with cursors as
      //                   a nested child page), events
      //   Advanced     → things most readers won't need day one (cross-page
      //                   shared elements, dynamic-element wiring)
      //   Integrations → Claude Code plugin + prompt template for any LLM
      //   Reference    → deep API: init() options + React API types
      //
      // Order is deliberate: capabilities is #3 because the built-in can-*
      // attributes are the 80% path, but the "why each one exists" overview
      // lives in concepts (#2) first so readers can pick the right primitive
      // without having to read the whole reference.
      //
      // "Using React" lives in Start (not a framework section) because the
      // rest of the docs show React inline, tabbed next to vanilla. The
      // primer just orients the React reader; the concept pages carry the
      // actual framework examples.
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Core concepts", slug: "concepts" },
            { label: "Using React", slug: "using-react" },
          ],
        },
        {
          label: "Capabilities",
          items: [{ label: "All capabilities", slug: "capabilities" }],
        },
        {
          label: "Data",
          items: [
            { label: "Data essentials", slug: "data/data-essentials" },
            { label: "Page-level data", slug: "data/page-data" },
            {
              label: "Presence",
              items: [
                { label: "Overview", slug: "data/presence" },
                { label: "Cursors", slug: "data/presence/cursors" },
              ],
            },
            { label: "Events", slug: "data/events" },
          ],
        },
        {
          label: "Advanced",
          items: [
            { label: "Shared elements", slug: "advanced/shared-elements" },
            { label: "Dynamic elements", slug: "advanced/dynamic-elements" },
            { label: "can-mirror playground", slug: "advanced/mirror-playground" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { label: "Building with AI", slug: "integrations/building-with-ai" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "playhtml.init() options", slug: "reference/init-options" },
            { label: "React API", slug: "reference/react-api" },
          ],
        },
      ],
    }),
    react(),
  ],
});
