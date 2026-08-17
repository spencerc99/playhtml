// ABOUTME: Opt-in redirect from the browser's new tab page to the walking record.
// ABOUTME: Caches the preference in memory, waiting on hydration only for the wake-up tab.

import browser from 'webextension-polyfill'

export const NEWTAB_TAKEOVER_KEY = 'newtab_takeover_enabled'

const WALKING_RECORD_PAGE = 'walking-record.html'

// Chromium reports the pending new tab under several spellings depending on
// version and profile settings.
const NEW_TAB_URLS = new Set([
  'chrome://newtab/',
  'chrome://new-tab-page/',
  'chrome://new-tab-page-third-party/',
  'about:newtab',
  'edge://newtab/',
])

function isNewTabUrl(url: string | undefined): boolean {
  if (!url) return false
  return NEW_TAB_URLS.has(url)
}

/**
 * Redirects newly created browser new tabs to the walking record when the user
 * has opted in.
 *
 * The preference is cached in the worker and refreshed from storage.onChanged
 * rather than read per tab. The one exception is the tab whose creation wakes
 * a suspended service worker: that event fires before the cache has hydrated,
 * so the handler awaits the initial storage read once — otherwise the wake-up
 * tab would silently stay on the browser default for opted-in users.
 */
export function initNewTabTakeover() {
  let enabled = false
  let hydrated = false

  const hydration = browser.storage.local
    .get([NEWTAB_TAKEOVER_KEY])
    .then((result) => {
      enabled = Boolean(result[NEWTAB_TAKEOVER_KEY])
    })
    .catch(() => {
      // Storage unavailable — stay opted out rather than hijacking new tabs.
    })
    .finally(() => {
      hydrated = true
    })

  // These listeners are absent in some environments (e.g. the test runner).
  browser.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return
    const change = changes[NEWTAB_TAKEOVER_KEY]
    if (change) enabled = Boolean(change.newValue)
  })

  browser.tabs.onCreated?.addListener(async (tab) => {
    if (tab.id == null) return
    // pendingUrl holds the destination before the tab commits; url is only
    // populated once it has. A brand new tab usually only has the former.
    const target = (tab as { pendingUrl?: string }).pendingUrl ?? tab.url
    if (!isNewTabUrl(target)) return

    if (!hydrated) await hydration
    if (!enabled) return

    browser.tabs
      .update(tab.id, { url: browser.runtime.getURL(WALKING_RECORD_PAGE) })
      .catch(() => {
        // Tab closed before the redirect landed — nothing to recover.
      })
  })
}
