#!/usr/bin/env node

/**
 * Custom release script for PlayHTML packages
 *
 * Why we need this script:
 * 1. npm version fails in our Bun-based workspace with error "Cannot read properties of null (reading 'isDescendantOf')"
 *    - This happens because npm expects package-lock.json but we use bun.lock
 *    - npm's workspace dependency resolution breaks when it can't find its lockfile
 *
 * 2. bun pm version doesn't create git commits/tags as documented
 *    - The Bun docs claim it should create commits and tags, but it doesn't work in practice
 *    - We tested with Bun 1.2.20 and it only updates package.json
 *
 * 3. We want consistent release workflow across all packages
 *    - Centralized logic instead of complex scripts in each package.json
 *    - Automatic git tagging with proper format (@package/name@version)
 *    - Build and publish in one command
 *
 * This script provides reliable version bumping, git operations, and npm publishing
 * while avoiding the npm workspace issues that plague our Bun-based setup.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const beta = args.includes("--beta");
const cleanArgs = args.filter((arg) => arg !== "--dry-run" && arg !== "--beta");

if (cleanArgs.length < 2) {
  console.error(
    "Usage: node scripts/release.js <package-name> <version-type> [--beta] [--dry-run]"
  );
  console.error("");
  console.error("Examples:");
  console.error("  node scripts/release.js common minor");
  console.error("  node scripts/release.js playhtml patch --dry-run");
  console.error("  node scripts/release.js react major");
  console.error("  node scripts/release.js react minor --beta");
  console.error("  node scripts/release.js react prerelease --beta --dry-run");
  console.error("");
  console.error("Package names: common, playhtml, react");
  console.error("Version types: patch, minor, major, prerelease");
  console.error(
    "Flags: --beta (publish to beta tag), --dry-run (preview only)"
  );
  process.exit(1);
}

const [packageName, versionType] = cleanArgs;

// Package name mappings
const packagePaths = {
  common: "packages/common",
  playhtml: "packages/playhtml",
  react: "packages/react",
};

const packageJsonNames = {
  common: "@playhtml/common",
  playhtml: "playhtml",
  react: "@playhtml/react",
};

if (!packagePaths[packageName]) {
  console.error(`Unknown package: ${packageName}`);
  console.error("Available packages: common, playhtml, react");
  process.exit(1);
}

if (!["patch", "minor", "major", "prerelease"].includes(versionType)) {
  console.error(`Invalid version type: ${versionType}`);
  console.error("Valid types: patch, minor, major, prerelease");
  process.exit(1);
}

const packagePath = packagePaths[packageName];
const packageJsonPath = path.join(packagePath, "package.json");
const fullPackageName = packageJsonNames[packageName];

console.log(
  `🚀 ${
    dryRun ? "[DRY RUN] " : ""
  }Releasing ${fullPackageName} with ${versionType} bump${
    beta ? " (beta)" : ""
  }...`
);

try {
  // 1. Read current package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const currentVersion = packageJson.version;

  // 2. Calculate new version
  let newVersion;

  if (versionType === "prerelease") {
    // Handle prerelease versioning
    const prereleaseMatch = currentVersion.match(
      /^(\d+\.\d+\.\d+)(?:-(.+)\.(\d+))?$/
    );
    if (prereleaseMatch) {
      const [, baseVersion, preId, preNumber] = prereleaseMatch;
      if (preId === "beta" && preNumber) {
        // Increment existing beta
        newVersion = `${baseVersion}-beta.${parseInt(preNumber) + 1}`;
      } else {
        // First beta or different prerelease
        newVersion = `${baseVersion}-beta.0`;
      }
    } else {
      // Fallback: add beta.0 to current version
      newVersion = `${currentVersion}-beta.0`;
    }
  } else {
    // Handle regular versioning
    const baseVersion = currentVersion.split("-")[0]; // Remove any prerelease suffix
    const versionParts = baseVersion.split(".").map(Number);

    switch (versionType) {
      case "patch":
        newVersion = `${versionParts[0]}.${versionParts[1]}.${
          versionParts[2] + 1
        }`;
        break;
      case "minor":
        newVersion = `${versionParts[0]}.${versionParts[1] + 1}.0`;
        break;
      case "major":
        newVersion = `${versionParts[0] + 1}.0.0`;
        break;
    }

    // Add beta suffix if --beta flag is used
    if (beta) {
      newVersion = `${newVersion}-beta.0`;
    }
  }

  console.log(`📦 Bumping ${currentVersion} → ${newVersion}`);

  if (!dryRun) {
    // 3. Update package.json
    packageJson.version = newVersion;
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + "\n"
    );
  } else {
    console.log("📝 [DRY RUN] Would update package.json");
  }

  // Note: Dependencies in other packages need to be updated manually
  // This ensures you have control over when dependent packages are updated
  if (packageName === "common") {
    console.log(
      "⚠️  Remember to update @playhtml/common dependency in playhtml and react packages"
    );
  } else if (packageName === "playhtml") {
    console.log("⚠️  Remember to update playhtml dependency in react package");
  }

  // 5. Build the package and handle special cases
  console.log(`🔨 ${dryRun ? "[DRY RUN] Would build" : "Building"} package...`);
  if (!dryRun) {
    if (packageName === "playhtml") {
      // Handle README symlink for playhtml package
      console.log("📄 Handling README symlink for playhtml package...");
      try {
        // Remove existing README symlink/file and copy the root README
        execSync(`cd ${packagePath} && rm -f README.md`, { stdio: "pipe" });
        execSync(`cd ${packagePath} && cp ../../README.md .`, {
          stdio: "pipe",
        });
      } catch (error) {
        console.log("⚠️  README handling failed, continuing...");
      }
    }
    execSync(`cd ${packagePath} && bun run build`, { stdio: "inherit" });
  } else if (packageName === "playhtml") {
    console.log(
      "📄 [DRY RUN] Would handle README symlink replacement for playhtml"
    );
  }

  // 6. Create git commit and tag
  const tag = `${fullPackageName}@${newVersion}`;
  console.log(
    `📝 ${
      dryRun ? "[DRY RUN] Would create" : "Creating"
    } git commit and tag: ${tag}`
  );

  if (!dryRun) {
    execSync(`git add ${packageJsonPath}`, { stdio: "inherit" });
    execSync(`git commit -m "${tag}"`, { stdio: "inherit" });
    execSync(`git tag ${tag}`, { stdio: "inherit" });
  }

  // 7. Publish to npm
  const publishTag = beta ? " --tag beta" : "";
  console.log(
    `📤 ${dryRun ? "[DRY RUN] Would publish" : "Publishing"} to npm${
      beta ? " (beta tag)" : ""
    }...`
  );
  if (!dryRun) {
    try {
      execSync(`cd ${packagePath} && npm publish${publishTag}`, {
        stdio: "inherit",
      });
    } finally {
      // Cleanup README for playhtml package regardless of publish success/failure
      if (packageName === "playhtml") {
        console.log("🧹 Cleaning up README for playhtml package...");
        try {
          execSync(
            `cd ${packagePath} && rm -f README.md && ln -s ../../README.md .`,
            { stdio: "pipe" }
          );
        } catch (error) {
          console.log("⚠️  README cleanup failed:", error.message);
        }
      }
    }
  } else if (packageName === "playhtml") {
    console.log("🧹 [DRY RUN] Would clean up README symlink after publish");
  }

  console.log(`✅ Successfully released ${tag}!`);
  console.log("");
  console.log("Next steps:");
  console.log("1. git push && git push --tags");
  if (packageName === "common" || packageName === "playhtml") {
    console.log("2. Update dependencies in dependent packages manually:");
    if (packageName === "common") {
      console.log(
        "   - Update @playhtml/common in playhtml and react packages"
      );
    } else if (packageName === "playhtml") {
      console.log("   - Update playhtml in react package");
    }
    console.log("3. Release the updated dependent packages");
  }
} catch (error) {
  console.error("❌ Release failed:", error.message);
  process.exit(1);
}
