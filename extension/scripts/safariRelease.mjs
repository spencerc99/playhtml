// ABOUTME: Chooses an editable macOS App Store version and submits its uploaded build for review.
// ABOUTME: Uses App Store Connect state so each extension release follows Apple's version lifecycle.

import { createPrivateKey, sign } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";

const API_URL = "https://api.appstoreconnect.apple.com/v1";
const BUNDLE_ID = process.env.SAFARI_BUNDLE_ID || "online.wewere.app";
const EDITABLE_STATES = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const RELEASED_STATES = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_VERSION"]);

export function selectSafariVersion(versions) {
  const macVersions = versions.filter((version) => version.attributes.platform === "MAC_OS");
  if (macVersions.length === 0) {
    throw new Error("No macOS App Store version exists for the Safari app.");
  }
  const parts = (version) => version.attributes.versionString.split(".").map(Number);
  macVersions.sort((left, right) => {
    const a = parts(left);
    const b = parts(right);
    for (let index = 0; index < 3; index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
    }
    return 0;
  });

  const current = macVersions[0];
  const state = current.attributes.appVersionState || current.attributes.appStoreState;
  if (EDITABLE_STATES.has(state)) {
    return { version: current.attributes.versionString, id: current.id };
  }
  if (!RELEASED_STATES.has(state)) {
    throw new Error(`Safari ${current.attributes.versionString} is ${state}; wait for Apple to finish before uploading another release.`);
  }
  const [major, minor] = parts(current);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error(`Cannot increment Safari App Store version ${current.attributes.versionString}.`);
  }
  return { version: `${major}.${minor + 1}`, id: null };
}

function token(privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "ES256", kid: process.env.APPLE_API_KEY_ID, typ: "JWT" });
  const claims = encode({ iss: process.env.APPLE_API_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" });
  const payload = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(payload), { key: createPrivateKey(privateKey), dsaEncoding: "ieee-p1363" });
  return `${payload}.${signature.toString("base64url")}`;
}

async function client() {
  for (const name of ["APPLE_API_KEY_ID", "APPLE_API_ISSUER_ID", "APPLE_API_KEY_PATH"]) {
    if (!process.env[name]) throw new Error(`${name} is required for App Store Connect.`);
  }
  const privateKey = await readFile(process.env.APPLE_API_KEY_PATH, "utf8");
  return async (method, path, body) => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token(privateKey)}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const details = result?.errors?.map((error) => `${error.code}: ${error.detail || error.title}`).join("; ") || response.statusText;
      throw new Error(`App Store Connect ${method} ${path} failed (${response.status}): ${details}`);
    }
    return result;
  };
}

async function appAndVersions(request) {
  const apps = await request("GET", `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  if (apps.data.length !== 1) throw new Error(`Expected one App Store Connect app for ${BUNDLE_ID}; found ${apps.data.length}.`);
  const appId = apps.data[0].id;
  const result = await request("GET", `/apps/${appId}/appStoreVersions?filter[platform]=MAC_OS&limit=200`);
  if (result.links?.next) throw new Error("Safari version history exceeds one API page; cannot safely choose a version.");
  return { appId, versions: result.data };
}

async function releaseNotes() {
  const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const lines = changelog.split("\n");
  const heading = lines.findIndex((line) => line.startsWith(`## ${packageData.version} `));
  if (heading < 0) throw new Error(`No release notes found for extension ${packageData.version}.`);
  const nextHeading = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  const section = lines.slice(heading + 1, nextHeading < 0 ? undefined : nextHeading);
  const notes = section.filter((line) => line.startsWith("- ")).map((line) => line.slice(2)).join("\n");
  if (!notes) throw new Error(`No release notes found for extension ${packageData.version}.`);
  if (notes.length > 4000) throw new Error(`App Store release notes for extension ${packageData.version} exceed 4000 characters.`);
  return notes;
}

async function prepare(request) {
  const { appId, versions } = await appAndVersions(request);
  const selected = selectSafariVersion(versions);
  await releaseNotes();
  process.stderr.write(`Safari App Store version ${selected.version}${selected.id ? " is editable" : " will be created after upload"}.\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${selected.version}\n`);
  }
  process.stdout.write(`${selected.version}\n`);
  return { appId, selected };
}

async function uploadedBuild(request, appId, buildNumber, version) {
  const path = `/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildNumber)}&filter[preReleaseVersion.platform]=MAC_OS&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&limit=200`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await request("GET", path);
    if (result.links?.next) throw new Error(`Safari build ${buildNumber} has more matches than one API page.`);
    const matches = result.data.filter((build) => build.attributes.version === buildNumber);
    if (matches.length > 1) throw new Error(`Multiple macOS builds numbered ${buildNumber} exist; cannot choose one safely.`);
    const build = matches[0];
    if (build?.attributes.processingState === "VALID") return build;
    if (["FAILED", "INVALID"].includes(build?.attributes.processingState)) {
      throw new Error(`Safari build ${buildNumber} failed App Store processing.`);
    }
    process.stderr.write(`Waiting for Safari ${version} build ${buildNumber} to finish processing.\n`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error(`Safari build ${buildNumber} did not finish App Store processing within 20 minutes.`);
}

async function complete(request) {
  const buildNumber = process.env.BUILD_NUMBER;
  const expectedVersion = process.env.VERSION;
  if (!buildNumber || !expectedVersion) throw new Error("BUILD_NUMBER and VERSION are required to submit Safari for review.");
  if (!/^\d+$/.test(buildNumber)) throw new Error(`Safari build number must contain only digits.`);
  const { appId, versions } = await appAndVersions(request);
  const selected = selectSafariVersion(versions);
  if (selected.version !== expectedVersion) {
    throw new Error(`Safari version changed from ${expectedVersion} to ${selected.version} during this release.`);
  }
  const build = await uploadedBuild(request, appId, buildNumber, expectedVersion);
  const version = selected.id ? { id: selected.id } : (await request("POST", "/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "MAC_OS", versionString: expectedVersion, releaseType: "AFTER_APPROVAL" },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  })).data;
  const localizations = await request("GET", `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  if (localizations.links?.next || localizations.data.length === 0) {
    throw new Error(`Safari ${expectedVersion} has no manageable App Store localizations.`);
  }
  const notes = await releaseNotes();
  for (const localization of localizations.data) {
    await request("PATCH", `/appStoreVersionLocalizations/${localization.id}`, {
      data: { type: "appStoreVersionLocalizations", id: localization.id, attributes: { whatsNew: notes } },
    });
  }
  await request("PATCH", `/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: build.id },
  });
  const submission = await request("POST", "/reviewSubmissions", {
    data: { type: "reviewSubmissions", relationships: { app: { data: { type: "apps", id: appId } } } },
  });
  await request("POST", "/reviewSubmissionItems", {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: submission.data.id } },
        appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
      },
    },
  });
  const submitted = await request("PATCH", `/reviewSubmissions/${submission.data.id}`, {
    data: { type: "reviewSubmissions", id: submission.data.id, attributes: { submitted: true } },
  });
  if (submitted.data.attributes.submitted !== true) {
    throw new Error(`Safari review submission ${submission.data.id} was not accepted as submitted.`);
  }
  process.stdout.write(`Safari ${expectedVersion} build ${buildNumber} submitted for App Review.\n`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const command = process.argv[2];
  const request = await client();
  if (command === "prepare") await prepare(request);
  else if (command === "complete") await complete(request);
  else throw new Error("Usage: node scripts/safariRelease.mjs <prepare|complete>");
}
