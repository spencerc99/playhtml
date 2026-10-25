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
      // Sidebar IA — mirrors the four kinds of shared state in the Core
      // concepts diagram (element data, page data, presence, events).
      //
      //   Start        → getting-started, concepts, examples
      //   Element data → capabilities, custom-elements, data/data-essentials,
      //                  advanced/{dynamic-elements,shared-elements,merging-data}
      //   Page data    → data/page-data
      //   Presence     → data/presence/*, plus element `live` data
      //   Events       → data/events
      //   Advanced     → advanced/{navigation,development,mirror-playground}
      //   Integrations → autogenerate (integrations/)
      //   Reference    → autogenerate (reference/)
      //
      // The groups are hand-rolled because they don't match directories on
      // disk: pages kept their URLs when the sidebar was regrouped. Only
      // Integrations and Reference autogenerate (set
      // `sidebar: { order: N }` in a page's frontmatter there).
      //
      // ⚠️ When adding a page outside integrations/ / reference/, add an
      // entry to the matching group here or it won't show up. Individual
      // example pages stay hidden (`sidebar.hidden`) and are linked from the
      // examples index.
      //
      // There is no separate React section: every page shows React inline,
      // tabbed next to vanilla, and the React setup lives in the React tab of
      // Getting started.
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Core concepts", slug: "concepts" },
            { label: "Examples", slug: "examples" },
          ],
        },
        {
          label: "Element data",
          items: [
            { label: "Built-in elements", slug: "capabilities" },
            { label: "Custom elements", slug: "custom-elements" },
            { label: "Data essentials", slug: "data/data-essentials" },
            { label: "Dynamic elements", slug: "advanced/dynamic-elements" },
            { label: "Shared elements", slug: "advanced/shared-elements" },
            { label: "Merging data changes", slug: "advanced/merging-data" },
          ],
        },
        {
          label: "Page data",
          items: [{ label: "Page data", slug: "data/page-data" }],
        },
        {
          label: "Presence",
          items: [
            { label: "Presence", slug: "data/presence" },
            { label: "Users", slug: "data/presence/users" },
            { label: "Cursors", slug: "data/presence/cursors" },
            {
              label: "Element live data",
              link: "/custom-elements/#users-and-live-per-user-state",
            },
          ],
        },
        {
          label: "Events",
          items: [{ label: "Events", slug: "data/events" }],
        },
        {
          label: "Advanced",
          items: [
            { label: "Navigation & SPAs", slug: "advanced/navigation" },
            {
              label: "Development & data cleanup",
              slug: "advanced/development",
            },
            {
              label: "can-mirror playground",
              slug: "advanced/mirror-playground",
            },
          ],
        },
        { label: "Integrations", autogenerate: { directory: "integrations" } },
        { label: "Reference", autogenerate: { directory: "reference" } },
      ],
    }),
    react(),
  ],
});
