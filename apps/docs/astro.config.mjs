// @ts-check
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: "https://playhtml.fun",
  base: "/docs",
  // Pages removed or merged elsewhere; keep old links working.
  redirects: {
    "/using-react": "/docs/getting-started/",
  },
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
        "@playhtml/react": path.resolve(
          repoRoot,
          "packages/react/src/index.tsx",
        ),
        "@playhtml/common": path.resolve(
          repoRoot,
          "packages/common/src/index.ts",
        ),
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
      favicon: "/icon.png",
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
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.com/invite/SKbsSf4ptU",
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
      // Sidebar IA
      //
      //   Examples     → examples index (top-level link, above the path)
      //   Start        → getting-started, concepts
      //   Shared state → capabilities, custom-elements, data-essentials,
      //                  page-data, presence/* (nested), events
      //   Advanced     → autogenerate (advanced/)
      //   Integrations → autogenerate (integrations/)
      //   Reference    → autogenerate (reference/)
      //
      // Start and Shared state are hand-rolled: Shared state pulls the
      // capability and custom element pages (top-level files) in next to the
      // data/ pages so all four kinds of shared state from Core concepts live
      // in one group.
      // Individual example pages stay hidden (`sidebar.hidden`) and are
      // linked from the examples index.
      //
      // ⚠️ When adding a page: in advanced/ / integrations/ / reference/,
      // set `sidebar: { order: N }` in its frontmatter and you're done.
      // Anywhere else, add an entry to the hand-rolled groups here too.
      //
      // There is no separate React section: every page shows React inline,
      // tabbed next to vanilla, and the React setup lives in the React tab of
      // Getting started.
      sidebar: [
        // Examples sits above the reading path so it's easy to find for
        // inspiration without interrupting prev/next from Getting started.
        {
          label: "Examples",
          slug: "examples",
          badge: { text: "inspo", variant: "tip" },
        },
        {
          label: "Start",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Core concepts", slug: "concepts" },
          ],
        },
        {
          label: "Shared state",
          items: [
            { label: "Built-in elements", slug: "capabilities" },
            { label: "Custom elements", slug: "custom-elements" },
            { label: "Data essentials", slug: "data/data-essentials" },
            { label: "Page-level data", slug: "data/page-data" },
            {
              label: "Presence",
              items: [
                { label: "Presence", slug: "data/presence" },
                { label: "Users", slug: "data/presence/users" },
                { label: "Cursors", slug: "data/presence/cursors" },
              ],
            },
            { label: "Events", slug: "data/events" },
          ],
        },
        { label: "Advanced", autogenerate: { directory: "advanced" } },
        { label: "Integrations", autogenerate: { directory: "integrations" } },
        { label: "Reference", autogenerate: { directory: "reference" } },
      ],
    }),
    react(),
  ],
});
