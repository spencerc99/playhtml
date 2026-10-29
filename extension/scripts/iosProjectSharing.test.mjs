// ABOUTME: Verifies the iOS project rewrite gives the app and its Safari extension one App Group.
// ABOUTME: Checks entitlements land on the right targets and native messaging joins the iOS manifest.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { withEntitlements, withNativeMessaging } from "./iosProjectSharing.mjs";

const PROJECT = `
/* Begin XCBuildConfiguration section */
		A1 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				PRODUCT_BUNDLE_IDENTIFIER = online.wewere.app;
				PRODUCT_NAME = "$(TARGET_NAME)";
			};
			name = Debug;
		};
		A2 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_ENTITLEMENTS = "old.entitlements";
				PRODUCT_BUNDLE_IDENTIFIER = online.wewere.app;
			};
			name = Release;
		};
		B1 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = online.wewere.app.Extension;
			};
			name = Debug;
		};
		C1 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				SDKROOT = iphoneos;
			};
			name = Debug;
		};
/* End XCBuildConfiguration section */
`;

describe("withEntitlements", () => {
  test("points each target's configurations at its own entitlements", () => {
    const updated = withEntitlements(PROJECT, {
      bundleId: "online.wewere.app",
      app: "app/app.entitlements",
      extension: "ext/ext.entitlements",
    });

    expect(
      updated.match(/CODE_SIGN_ENTITLEMENTS = "app\/app.entitlements";/g),
    ).toHaveLength(2);
    expect(
      updated.match(/CODE_SIGN_ENTITLEMENTS = "ext\/ext.entitlements";/g),
    ).toHaveLength(1);
    expect(updated).not.toContain("old.entitlements");
    // The project-wide configuration is left as it was.
    expect(updated).toContain(
      "buildSettings = {\n\t\t\t\tSDKROOT = iphoneos;\n\t\t\t};",
    );
  });

  test("refuses a project missing either target", () => {
    expect(() =>
      withEntitlements(PROJECT, {
        bundleId: "online.wewere.other",
        app: "a",
        extension: "b",
      }),
    ).toThrow(/Could not find both targets/);
  });
});

test("adds native messaging to the iOS manifest once", () => {
  const manifest = {
    name: "we were online",
    permissions: ["storage", "nativeMessaging"],
  };
  expect(withNativeMessaging(manifest).permissions).toEqual([
    "storage",
    "nativeMessaging",
  ]);
  expect(withNativeMessaging({ name: "x" }).permissions).toEqual([
    "nativeMessaging",
  ]);
});

test("the packager installs the shared folder on both sides", async () => {
  const script = await readFile(
    path.join(process.cwd(), "scripts/packageSafariIOS.sh"),
    "utf8",
  );
  const app = await readFile(
    path.join(process.cwd(), "ios/entitlements/app.entitlements"),
    "utf8",
  );
  const extension = await readFile(
    path.join(process.cwd(), "ios/entitlements/extension.entitlements"),
    "utf8",
  );
  const controller = await readFile(
    path.join(process.cwd(), "ios/app/ViewController.swift"),
    "utf8",
  );

  expect(script).toContain("withNativeMessaging");
  expect(script).toContain("cp ios/extension/SafariWebExtensionHandler.swift");
  expect(script).toContain("ios/shared/SharedContainer.swift");
  expect(script).toContain("scripts/iosProjectSharing.mjs");
  for (const entitlements of [app, extension]) {
    expect(entitlements).toContain("com.apple.security.application-groups");
    expect(entitlements).toContain("group.online.wewere.app");
  }
  expect(controller).toContain('SharedContainer.handle(message, side: "app")');
});
