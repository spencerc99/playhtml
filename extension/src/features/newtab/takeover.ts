// ABOUTME: Opt-in redirect from the browser's new tab page to the walking record.
// ABOUTME: Keeps the preference in memory so the redirect never waits on storage.

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
 * rather than read per tab: an await on storage before tabs.update leaves the
 * default new tab painted for that much longer, which reads as a flash.
 */
export function initNewTabTakeover() {
  let enabled = false

  browser.storage.local
    .get([NEWTAB_TAKEOVER_KEY])
    .then((result) => {
      enabled = Boolean(result[NEWTAB_TAKEOVER_KEY])
    })
    .catch(() => {
      // Storage unavailable — stay opted out rather than hijacking new tabs.
    })

  // These listeners are absent in some environments (e.g. the test runner).
  browser.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return
    const change = changes[NEWTAB_TAKEOVER_KEY]
    if (change) enabled = Boolean(change.newValue)
  })

  browser.tabs.onCreated?.addListener((tab) => {
    if (!enabled || tab.id == null) return
    // pendingUrl holds the destination before the tab commits; url is only
    // populated once it has. A brand new tab usually only has the former.
    const target = (tab as { pendingUrl?: string }).pendingUrl ?? tab.url
    if (!isNewTabUrl(target)) return

    browser.tabs
      .update(tab.id, { url: browser.runtime.getURL(WALKING_RECORD_PAGE) })
      .catch(() => {
        // Tab closed before the redirect landed — nothing to recover.
      })
  })
}
