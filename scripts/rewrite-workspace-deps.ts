// ABOUTME: Rewrites `workspace:*` / `workspace:^` / `workspace:~` protocol deps
// ABOUTME: to real versions before publish, since Bun doesn't do this natively.

/*
 * Why this script exists:
 *
 * Our internal deps use `workspace:^` so that in-repo sibling packages are
 * always resolved to the local copy during development. Every other major
 * package manager (pnpm, yarn berry, even npm via its publish command)
 * automatically rewrites these specifiers to real semver ranges when the
 * package is published, so consumers on npm get a resolvable version.
 *
 * Bun does NOT currently do this rewrite on `bun publish` or when
 * `@changesets/cli` calls out to the npm registry via Bun's environment.
 * The unresolved `workspace:^` string ends up in the published `package.json`
 * on npm, which breaks installs for any consumer:
 *
 *   https://github.com/oven-sh/bun/issues/16074
 *
 * Run this script between `changeset version` and `changeset publish` so the
 * published tarballs contain real version ranges. Delete it once Bun ships
 * native rewriting and update the release scripts accordingly.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PUBLISHABLE_PACKAGES = [
  "packages/playhtml",
  "packages/common",
  "packages/react",
];

type PackageJson = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const pkgPaths = PUBLISHABLE_PACKAGES.map((dir) =>
  join(process.cwd(), dir, "package.json"),
);
const pkgs: PackageJson[] = pkgPaths.map((p) =>
  JSON.parse(readFileSync(p, "utf8")),
);
const versionByName = new Map(pkgs.map((p) => [p.name, p.version]));

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

for (let i = 0; i < pkgs.length; i++) {
  const pkg = pkgs[i];
  let changed = false;

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;

    for (const [depName, specifier] of Object.entries(deps)) {
      if (!specifier.startsWith("workspace:")) continue;

      const targetVersion = versionByName.get(depName);
      if (!targetVersion) {
        throw new Error(
          `${pkg.name}: dep "${depName}" uses ${specifier} but is not a publishable workspace package`,
        );
      }

      const protocol = specifier.slice("workspace:".length);
      let rewritten: string;
      if (protocol === "*" || protocol === "^") {
        rewritten = `^${targetVersion}`;
      } else if (protocol === "~") {
        rewritten = `~${targetVersion}`;
      } else {
        rewritten = targetVersion;
      }

      deps[depName] = rewritten;
      changed = true;
      console.log(
        `${pkg.name}: ${field}.${depName} ${specifier} -> ${rewritten}`,
      );
    }
  }

  if (changed) {
    writeFileSync(pkgPaths[i], JSON.stringify(pkg, null, 2) + "\n");
  }
}
