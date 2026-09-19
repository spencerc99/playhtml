// ABOUTME: Opt-in redirect from the browser's new tab page to the walking record.
// ABOUTME: Reads the preference from storage per new tab so a startup write can't be missed.

import browser from 'webextension-polyfill'

export const NEWTAB_TAKEOVER_KEY = 'newtab_takeover_enabled'

const WALKING_RECORD_PAGE = 'walking-record.html'

// Both engines report the new tab under several spellings depending on version
// and profile settings. Firefox reports `about:newtab` on the created tab
// itself, so the same match covers Chromium and Firefox.
const NEW_TAB_URLS = new Set([
  'chrome://newtab/',
  'chrome://new-tab-page/',
  'chrome://new-tab-page-third-party/',
  'about:newtab',
  'about:home',
  'edge://newtab/',
])

function isNewTabUrl(url: string | undefined): boolean {
  if (!url) return false
  return NEW_TAB_URLS.has(url)
}

/**
 * How long after a tab is created its first navigation still counts as the new
 * tab settling rather than the user going somewhere.
 */
const NEW_TAB_SETTLE_MS = 2_000

/**
 * Redirects newly created browser new tabs to the walking record when the user
 * has opted in.
 *
 * The preference is read from storage on each new tab rather than cached. A
 * cached flag goes permanently stale when the key is written during background
 * startup — the update path grandfathers the old forced new tab by writing it
 * from `runtime.onInstalled`, which can both race the initial read and emit its
 * `storage.onChanged` before this module attaches a listener. Storage reads are
 * cheap and only happen once per new tab, so there is nothing to win by caching.
 *
 * Two events can identify the new tab because Firefox is inconsistent about
 * which one carries the URL: sometimes `onCreated` already reports
 * `about:newtab`, and sometimes it reports `about:blank` and the real URL only
 * arrives in a following `onUpdated`. Both spellings were observed within a
 * single browser session, so both paths are required.
 */
export function initNewTabTakeover() {
  const redirectedTabIds = new Set<number>()
  /** Tabs created blank, still within the window where they may become a new tab. */
  const settlingTabIds = new Map<number, ReturnType<typeof setTimeout>>()

  async function isEnabled(): Promise<boolean> {
    try {
      const stored = await browser.storage.local.get([NEWTAB_TAKEOVER_KEY])
      return Boolean(stored[NEWTAB_TAKEOVER_KEY])
    } catch {
      // Storage unavailable — stay opted out rather than hijacking new tabs.
      return false
    }
  }

  function stopSettling(tabId: number) {
    const timeout = settlingTabIds.get(tabId)
    if (timeout) clearTimeout(timeout)
    settlingTabIds.delete(tabId)
  }

  async function redirect(tabId: number) {
    if (redirectedTabIds.has(tabId)) return
    redirectedTabIds.add(tabId)
    stopSettling(tabId)

    if (!(await isEnabled())) {
      redirectedTabIds.delete(tabId)
      return
    }

    browser.tabs
      .update(tabId, { url: browser.runtime.getURL(WALKING_RECORD_PAGE) })
      .catch(() => {
        // Tab closed before the redirect landed — nothing to recover.
      })
  }

  browser.tabs.onCreated?.addListener(async (tab) => {
    if (tab.id == null) return
    const tabId = tab.id

    // pendingUrl holds the destination before the tab commits; url is only
    // populated once it has. Firefox populates url, Chromium pendingUrl.
    const target = (tab as { pendingUrl?: string }).pendingUrl ?? tab.url
    if (isNewTabUrl(target)) {
      await redirect(tabId)
      return
    }

    // A tab that starts blank may still be resolving into the new tab page.
    if (target === undefined || target === 'about:blank') {
      settlingTabIds.set(
        tabId,
        setTimeout(() => settlingTabIds.delete(tabId), NEW_TAB_SETTLE_MS),
      )
    }
  })

  browser.tabs.onUpdated?.addListener(async (tabId, changeInfo) => {
    const url = (changeInfo as { url?: string }).url
    if (!url || !settlingTabIds.has(tabId)) return
    // Still blank — keep waiting for the tab to settle.
    if (url === 'about:blank') return

    // The first real URL decides: the new tab page gets redirected, anything
    // else means the user navigated and the tab is no longer ours to touch.
    stopSettling(tabId)
    if (isNewTabUrl(url)) await redirect(tabId)
  })

  browser.tabs.onRemoved?.addListener((tabId) => {
    stopSettling(tabId)
    redirectedTabIds.delete(tabId)
  })
}
