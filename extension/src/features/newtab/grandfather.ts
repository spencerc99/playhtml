// ABOUTME: Carries the old forced new tab takeover forward as an explicit preference.
// ABOUTME: Only versions that actually shipped the manifest override are grandfathered.

import browser from 'webextension-polyfill'
import { NEWTAB_TAKEOVER_KEY } from './takeover'

/**
 * First released version whose manifest declared
 * `chrome_url_overrides.newtab`. Verified against the published tags:
 * 0.1.20's wxt.config.ts has no override, 0.1.21's does.
 */
export const FIRST_FORCED_NEWTAB_VERSION = '0.1.21'

/** Compares dotted numeric versions. Returns <0, 0, or >0 like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (Number.isNaN(l) || Number.isNaN(r)) return 0
    if (l !== r) return l - r
  }
  return 0
}

/**
 * True when `previousVersion` shipped the forced new tab override, so the user
 * has been living with the history page as their new tab.
 *
 * The upper bound is the running version rather than a pinned constant: this
 * build is the one that removes the override, so every version below it that
 * is at or past the first override release had the forced new tab. That keeps
 * the check correct whether this ships as a patch, minor, or major bump.
 */
export function hadForcedNewTab(
  previousVersion: string | undefined,
  currentVersion: string,
): boolean {
  if (!previousVersion) return false
  return (
    compareVersions(previousVersion, FIRST_FORCED_NEWTAB_VERSION) >= 0 &&
    compareVersions(previousVersion, currentVersion) < 0
  )
}

/**
 * Preserves the new tab someone already has. Updating used to be the only way
 * to get the history page on new tabs; now that it is a preference, an update
 * that left the key unset would silently take that away.
 *
 * Never overwrites an existing value: once the key is set the user has spoken,
 * including when they set it to false.
 */
export async function grandfatherNewTabTakeover(
  previousVersion: string | undefined,
  currentVersion: string = browser.runtime.getManifest().version,
): Promise<void> {
  if (!hadForcedNewTab(previousVersion, currentVersion)) return

  const stored = await browser.storage.local.get([NEWTAB_TAKEOVER_KEY])
  if (stored[NEWTAB_TAKEOVER_KEY] !== undefined) return

  await browser.storage.local.set({ [NEWTAB_TAKEOVER_KEY]: true })
}
