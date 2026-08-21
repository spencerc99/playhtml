// ABOUTME: Background service worker — holds the extension-origin event store and
// ABOUTME: coordinates event writes, uploads, and data reads for all extension surfaces
import browser from 'webextension-polyfill'
import { LocalEventStore } from '../storage/LocalEventStore'
import type {
  QueryOptions,
  WalkingRecordTraceTarget,
} from '../storage/LocalEventStore'
import { uploadEvents } from '../storage/sync'
import { fetchEventsByPid } from '../storage/restore'
import type { CollectionEvent } from '@playhtml/extension-types'
import type { ScrapEventData } from '../collectors/types'
import { getCanonicalScrapKey, getScrapKey } from '../collectors/scrapUtils'
import {
  collectionModeStorageKey,
  normalizeCollectionMode,
  supportsSharedCollection,
} from '../collectors/modes'
import {
  ensurePlayerIdentity,
  getPlayerProfile,
  getPublicPlayerIdentity,
  recordDiscoveredSite,
} from '../storage/playerIdentity'
import { syncStoredPlayerColor } from '../storage/playerColor'
import { VERBOSE } from '../config'
import { gzipString, gunzipToString } from '../utils/dataTransfer'
import { normalizeUrl, extractDomain } from '../utils/urlNormalization'
import {
  loadState,
  saveState,
  todayString,
  resetDailyIfNeeded,
  isOnCooldown,
  recordToastShown,
} from '../milestones/state'
import {
  checkAllMilestones,
  detectLongGapReturn,
  pxToMiles,
} from '../milestones/milestones'
import { getSessionId } from '../storage/participant'
import { recordAnnouncementInstall } from '../announcements/announcement-storage'
import { isUserActive } from '../utils/userActivity'
import { initNewTabTakeover } from '../features/newtab/takeover'
import { grandfatherNewTabTakeover } from '../features/newtab/grandfather'
import {
  calculateCursorDistance,
  queryCursorEventsForPortrait,
} from '../utils/cursorDistance'
import {
  getOrCreateWikipediaHandle,
  rerollWikipediaHandle,
  setWikipediaHandle,
} from '../storage/wikipediaHandle'
import {
  FEATURE_OVERRIDES_STORAGE_KEY,
  FEATURE_ACCESS_STORAGE_KEY,
  getAllFeatureStates,
  refreshFeatureAccess,
} from '../features/featureAccess'
import { FEATURE_IDS } from '../flags'
import {
  SLOW_MODE_STATE_KEY,
  isSlowModeRideOutcome,
  normalizeSlowModeState,
  updateSlowModeRide,
} from '../features/slowMode/slowMode'
import { initSlowModeInterception } from '../features/slowMode/slowModeBackground'

function replyWithWikipediaHandle(
  request: Promise<string>,
  reply: (response: { handle?: string; error?: string }) => void,
): void {
  request
    .then((handle) => reply({ handle }))
    .catch((error: unknown) =>
      reply({ error: error instanceof Error ? error.message : String(error) }),
    )
}

interface ScrapRecordBase {
  id: string
  key: string
  domain: string
  pageUrl: string
  ts: number
  pageTitle: string
  faviconUrl?: string
}

export type ScrapRecord = ScrapRecordBase &
  (
    | {
        kind: 'image'
        src: string
        alt?: string
        naturalWidth: number
        naturalHeight: number
      }
    | {
        kind: 'button'
        text: string
        styles: Record<string, string>
        innerSvg?: string
      }
    | {
        kind: 'svg-icon'
        markup: string
        width: number
        height: number
      }
    | {
        kind: 'cursor'
        url: string
        hotspotX?: number
        hotspotY?: number
      }
  )

const FEATURE_ACCESS_REFRESH_ALARM = 'refreshFeatureAccess'

function toScrapRecord(event: CollectionEvent): ScrapRecord | undefined {
  const kind = (event.data as { kind?: unknown } | null)?.kind
  if (
    kind !== 'image' &&
    kind !== 'button' &&
    kind !== 'svg-icon' &&
    kind !== 'cursor'
  ) {
    return undefined
  }
  if (!event.domain) {
    throw new Error(`Scrap event ${event.id} is missing its domain`)
  }

  const data = event.data as ScrapEventData
  const base: ScrapRecordBase = {
    id: event.id,
    key: getScrapKey(data),
    domain: event.domain,
    pageUrl: event.meta.url,
    ts: event.ts,
    pageTitle: data.pageTitle,
    ...(data.faviconUrl ? { faviconUrl: data.faviconUrl } : {}),
  }

  switch (data.kind) {
    case 'image':
      return {
        ...base,
        kind: data.kind,
        src: data.src,
        ...(data.alt ? { alt: data.alt } : {}),
        naturalWidth: data.naturalWidth,
        naturalHeight: data.naturalHeight,
      }
    case 'button':
      return {
        ...base,
        kind: data.kind,
        text: data.text,
        styles: data.styles,
        ...(data.innerSvg ? { innerSvg: data.innerSvg } : {}),
      }
    case 'svg-icon':
      return {
        ...base,
        kind: data.kind,
        markup: data.markup,
        width: data.width,
        height: data.height,
      }
    case 'cursor':
      return {
        ...base,
        kind: data.kind,
        url: data.url,
        ...(data.hotspotX !== undefined ? { hotspotX: data.hotspotX } : {}),
        ...(data.hotspotY !== undefined ? { hotspotY: data.hotspotY } : {}),
      }
  }
}

const store = new LocalEventStore()

/**
 * Storage-time dedup for scrap ("element") events: drops incoming events
 * whose canonical identity (see getCanonicalScrapKey) already exists in the
 * store, so near-duplicates captured across pages/sessions are never
 * persisted. `knownCanonicalScrapKeys` is lazily populated by scanning
 * existing stored element events on first use, then kept current as new
 * events are accepted. This matches the render-time dedup in ScrapCollage's
 * canonicalScrapKey, but skips persistence entirely instead of collapsing
 * duplicates at render.
 *
 * The set is rebuilt via the same lazy scan on every service-worker restart
 * (MV3 workers are short-lived) — `knownCanonicalScrapKeysInitPromise` makes
 * sure two STORE_EVENTS batches arriving before the scan completes don't
 * both trigger a scan or race past each other.
 */
const knownCanonicalScrapKeys = new Set<string>()
let knownCanonicalScrapKeysInitialized = false
let knownCanonicalScrapKeysInitPromise: Promise<void> | null = null

function resolveScrapEventDomain(event: CollectionEvent): string {
  return event.domain || extractDomain(event.meta.url)
}

async function ensureKnownCanonicalScrapKeys(): Promise<void> {
  if (knownCanonicalScrapKeysInitialized) return
  if (knownCanonicalScrapKeysInitPromise)
    return knownCanonicalScrapKeysInitPromise

  knownCanonicalScrapKeysInitPromise = (async () => {
    const existing = await store.queryByType('element')
    for (const event of existing) {
      const kind = (event.data as { kind?: unknown } | null)?.kind
      if (
        kind !== 'image' &&
        kind !== 'button' &&
        kind !== 'svg-icon' &&
        kind !== 'cursor'
      ) {
        continue
      }
      const domain = resolveScrapEventDomain(event)
      const canonicalKey = getCanonicalScrapKey(
        domain,
        event.data as ScrapEventData,
      )
      knownCanonicalScrapKeys.add(canonicalKey)
    }
  })()

  try {
    await knownCanonicalScrapKeysInitPromise
    knownCanonicalScrapKeysInitialized = true
  } finally {
    // Cleared so a failed scan retries on the next batch; a successful scan
    // is latched by knownCanonicalScrapKeysInitialized instead.
    knownCanonicalScrapKeysInitPromise = null
  }
}

/**
 * Filters incoming events, dropping "element" (scrap) events whose canonical
 * identity is already known — either already persisted, or a duplicate of
 * another event earlier in this same batch. Non-element events pass through
 * unchanged. Accepted scrap events are added to the known-keys set so later
 * batches (and later events within this batch) see them as duplicates too.
 */
async function dedupeScrapEvents(
  events: CollectionEvent[],
): Promise<CollectionEvent[]> {
  const hasElementEvent = events.some((event) => event.type === 'element')
  if (!hasElementEvent) return events

  await ensureKnownCanonicalScrapKeys()

  const accepted: CollectionEvent[] = []
  for (const event of events) {
    if (event.type !== 'element') {
      accepted.push(event)
      continue
    }

    const kind = (event.data as { kind?: unknown } | null)?.kind
    if (
      kind !== 'image' &&
      kind !== 'button' &&
      kind !== 'svg-icon' &&
      kind !== 'cursor'
    ) {
      accepted.push(event)
      continue
    }

    const domain = resolveScrapEventDomain(event)
    const canonicalKey = getCanonicalScrapKey(
      domain,
      event.data as ScrapEventData,
    )
    if (knownCanonicalScrapKeys.has(canonicalKey)) continue

    knownCanonicalScrapKeys.add(canonicalKey)
    accepted.push(event)
  }

  return accepted
}

const LOCAL_RAW_EVENT_RETENTION_ENABLED = false
const LOCAL_RAW_EVENT_RETENTION_DAYS = 30
const LOCAL_RAW_EVENT_RETENTION_MS =
  LOCAL_RAW_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
const LOCAL_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000
const LOCAL_RETENTION_ALARM_PERIOD_MINUTES = 24 * 60
const LOCAL_RETENTION_ALARM = 'pruneLocalEvents'
const LOCAL_RETENTION_LAST_RUN_KEY = 'localRetentionLastRun'

let localRetentionRunning = false

async function getBrowserStorageUsageBytes(): Promise<number | null> {
  // Firefox ESR 140 omits storage.local.getBytesInUse, so this remains optional.
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/getBytesInUse
  const storageArea = browser.storage.local as typeof browser.storage.local & {
    getBytesInUse?: (keys?: string | string[] | null) => Promise<number>
  }

  if (!storageArea.getBytesInUse) return null

  try {
    const bytes = await storageArea.getBytesInUse(null)
    return typeof bytes === 'number' ? bytes : null
  } catch {
    return null
  }
}

async function getExtensionLocalUsageBytes(): Promise<number | null> {
  const [originUsageBytes, browserStorageUsageBytes] = await Promise.all([
    typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? navigator.storage
          .estimate()
          .then((estimate) =>
            typeof estimate.usage === 'number' ? estimate.usage : null,
          )
          .catch(() => null)
      : Promise.resolve(null),
    getBrowserStorageUsageBytes(),
  ])

  const usageParts = [originUsageBytes, browserStorageUsageBytes].filter(
    (bytes): bytes is number => typeof bytes === 'number',
  )

  if (usageParts.length === 0) return null
  return usageParts.reduce((sum, bytes) => sum + bytes, 0)
}

async function flushPendingUploads(): Promise<void> {
  try {
    const pending = await store.getPendingEvents(500)
    if (pending.length === 0) return

    const types = Array.from(new Set(pending.map((e) => e.type)))
    const keys = types.map((t) => collectionModeStorageKey(t))
    const result = await browser.storage.local.get(keys)

    const uploadable = pending.filter((e) => {
      if (!supportsSharedCollection(e.type)) return false
      const mode = normalizeCollectionMode(
        e.type,
        result[collectionModeStorageKey(e.type)],
      )
      return mode === 'shared'
    })

    if (uploadable.length > 0) {
      await uploadEvents(uploadable)
    }

    // Mark all pending events uploaded (local-mode events are marked too so they don't pile up)
    await store.markEventsAsUploaded(pending.map((e) => e.id))
  } catch (e) {
    console.error('[Background] flushPendingUploads error:', e)
  }
}

async function runLocalRetention(
  options: { force?: boolean } = {},
): Promise<void> {
  if (localRetentionRunning) return

  localRetentionRunning = true
  try {
    const now = Date.now()
    if (!options.force) {
      const result = await browser.storage.local.get(
        LOCAL_RETENTION_LAST_RUN_KEY,
      )
      const lastRun = result[LOCAL_RETENTION_LAST_RUN_KEY]
      if (
        typeof lastRun === 'number' &&
        now - lastRun < LOCAL_RETENTION_INTERVAL_MS
      ) {
        return
      }
    }

    await flushPendingUploads()
    await store.ensureHistoricalStats()

    const cutoffTs = now - LOCAL_RAW_EVENT_RETENTION_MS
    const deleted = await store.pruneUploadedEventsOlderThan(cutoffTs)
    await browser.storage.local.set({
      [LOCAL_RETENTION_LAST_RUN_KEY]: Date.now(),
    })

    if (VERBOSE && deleted > 0) {
      console.log(
        `[Background] Pruned ${deleted} uploaded local events older than ${LOCAL_RAW_EVENT_RETENTION_DAYS} days`,
      )
    }
  } catch (e) {
    console.error('[Background] local retention error:', e)
  } finally {
    localRetentionRunning = false
  }
}

export default defineBackground(() => {
  // Storage durability is provided by the `unlimitedStorage` permission
  // declared in wxt.config.ts — Chromium's quota manager exempts extensions
  // with this permission from both quota caps and automatic eviction.
  //
  // navigator.storage.persist() is deliberately NOT called here: it returns
  // false in extensions regardless of actual protection status (known
  // Chromium issue #357622670), so it's a misleading signal to rely on.

  // Opt-in: send new browser tabs to the walking record instead of the
  // default new tab page. Off unless the user turns it on.
  initNewTabTakeover()
  const slowModeInterception = initSlowModeInterception()

  // Forward the manifest "open-inventory" command to the active tab's content script.
  // Manifest commands are browser-routed, so this works reliably on every page.
  // (browser.commands is absent in some environments — e.g. the test runner — so guard it.)
  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== 'open-inventory') return
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (tab?.id != null) {
      try {
        await browser.tabs.sendMessage(tab.id, { type: 'wwo:open-inventory' })
      } catch {
        // No content script on this page (e.g. chrome:// or the web store) — ignore.
      }
    }
  })

  // Extension lifecycle
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      recordAnnouncementInstall().catch((e) => {
        console.warn('Failed to record extension install time', e)
      })
      // First time installation - setup default identity
      initializePlayerIdentity().then(() => initializeIdentityServices())
      // Open setup page in a new tab
      const url = browser.runtime.getURL('options.html')
      browser.tabs.create({ url }).catch((e) => {
        console.warn('Failed to open setup page on install', e)
      })
    } else if (details.reason === 'update') {
      // Extension updated — ensure key is upgraded, then sync
      initializePlayerIdentity().then(() => initializeIdentityServices())
      grandfatherNewTabTakeover(details.previousVersion).catch((e) => {
        console.warn('Failed to carry over the new tab preference', e)
      })
    } else {
      initializePlayerIdentity().then(() => initializeIdentityServices())
    }
  })

  // Set up 5-minute milestone check alarm (backstop for non-navigation
  // milestones like cursor distance and screen time). Domain milestones
  // additionally fire on navigation — see scheduleMilestoneCheck.
  browser.alarms.create('checkMilestones', { periodInMinutes: 5 })
  browser.alarms.create(FEATURE_ACCESS_REFRESH_ALARM, { periodInMinutes: 60 })
  if (LOCAL_RAW_EVENT_RETENTION_ENABLED) {
    browser.alarms.create(LOCAL_RETENTION_ALARM, {
      periodInMinutes: LOCAL_RETENTION_ALARM_PERIOD_MINUTES,
    })
  }

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkMilestones') {
      await runMilestoneCheck()
      return
    }

    if (alarm.name === FEATURE_ACCESS_REFRESH_ALARM) {
      await refreshExperimentAccess().catch(() => {})
      return
    }

    if (
      LOCAL_RAW_EVENT_RETENTION_ENABLED &&
      alarm.name === LOCAL_RETENTION_ALARM
    ) {
      await runLocalRetention({ force: true })
    }
  })

  if (LOCAL_RAW_EVENT_RETENTION_ENABLED) {
    runLocalRetention().catch((e) => {
      console.error('[Background] local retention startup error:', e)
    })
  }

  // Single-flight + 1s trailing debounce. Rapid navigation events coalesce
  // into one check, and we never run two checks concurrently (the function
  // reads-modifies-writes shared state).
  let milestoneCheckRunning = false
  let milestoneCheckQueued = false
  let milestoneCheckTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleMilestoneCheck() {
    if (milestoneCheckTimer) return
    milestoneCheckTimer = setTimeout(async () => {
      milestoneCheckTimer = null
      if (milestoneCheckRunning) {
        milestoneCheckQueued = true
        return
      }
      milestoneCheckRunning = true
      try {
        await runMilestoneCheck()
      } finally {
        milestoneCheckRunning = false
        if (milestoneCheckQueued) {
          milestoneCheckQueued = false
          scheduleMilestoneCheck()
        }
      }
    }, 1000)
  }

  // Ensure player identity has an ECDSA keypair.
  async function initializePlayerIdentity() {
    try {
      await ensurePlayerIdentity()
    } catch (error) {
      console.error('Failed to initialize player identity:', error)
    }
  }

  // Sync participant identity color to server on startup.
  async function syncIdentityToServer() {
    try {
      await syncStoredPlayerColor()
    } catch {}
  }

  async function updateExperimentBadge() {
    if (!browser.action) return
    const states = await getAllFeatureStates()
    const experimentsActive = FEATURE_IDS.some(
      (feature) =>
        states[feature].source !== 'released' && states[feature].enabled,
    )
    await browser.action.setBadgeText({ text: experimentsActive ? 'LAB' : '' })
    if (experimentsActive) {
      await browser.action.setBadgeBackgroundColor({ color: '#b85c38' })
      await browser.action.setTitle({ title: 'we were online · experiments active' })
    } else {
      await browser.action.setTitle({ title: 'we were online' })
    }
  }

  async function refreshExperimentAccess() {
    const identity = await getPublicPlayerIdentity()
    if (import.meta.env.MODE !== 'development' && identity?.publicKey) {
      await refreshFeatureAccess(identity.publicKey)
    }
    await updateExperimentBadge()
  }

  async function initializeIdentityServices() {
    await Promise.all([
      syncIdentityToServer(),
      refreshExperimentAccess().catch(() => updateExperimentBadge()),
    ])
  }

  updateExperimentBadge().catch(() => {})

  browser.storage.onChanged?.addListener((changes, areaName) => {
    if (
      areaName === 'local' &&
      (changes[FEATURE_ACCESS_STORAGE_KEY] ||
        changes[FEATURE_OVERRIDES_STORAGE_KEY])
    ) {
      updateExperimentBadge().catch(() => {})
    }
  })

  // Hydrate cursor_color onto locally-stored events from the user's identity.
  // All events in the local store are from this user (possibly under different
  // pids due to identity migration), so we apply the color unconditionally.
  async function hydrateCursorColor(
    events: CollectionEvent[],
  ): Promise<CollectionEvent[]> {
    if (events.length === 0) return events
    const playerIdentity = await getPublicPlayerIdentity()
    const cursorColor = playerIdentity?.playerStyle?.colorPalette?.[0]
    if (!cursorColor) return events
    for (const evt of events) {
      evt.meta.cursor_color = cursorColor
    }
    return events
  }

  // Cross-site messaging coordination
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = sendResponse as (response?: any) => void
    if (message.type === 'SLOW_MODE_FORM_STATE' && sender.tab?.id != null) {
      slowModeInterception.setFormInProgress(
        sender.tab.id,
        message.inProgress === true,
      )
      reply({ success: true })
      return
    }

    if (message.type === 'SLOW_MODE_RIDE_OUTCOME') {
      if (
        typeof message.rideId !== 'string' ||
        !isSlowModeRideOutcome(message.outcome)
      ) {
        reply({ success: false })
        return
      }
      browser.storage.local
        .get(SLOW_MODE_STATE_KEY)
        .then((stored) =>
          browser.storage.local.set({
            [SLOW_MODE_STATE_KEY]: updateSlowModeRide(
              normalizeSlowModeState(stored[SLOW_MODE_STATE_KEY]),
              message.rideId,
              message.outcome,
            ),
          }),
        )
        .then(() => reply({ success: true }))
        .catch((error) => {
          console.warn('[Slow Mode] failed to update ride log:', error)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'GET_SESSION_ID') {
      getSessionId().then(reply)
      return true
    }

    if (message.type === 'GET_PUBLIC_PLAYER_IDENTITY') {
      getPublicPlayerIdentity().then(reply)
      return true // Will respond asynchronously
    }

    if (message.type === 'GET_PLAYER_PROFILE') {
      getPlayerProfile().then(reply)
      return true // Will respond asynchronously
    }

    if (message.type === 'GET_OR_CREATE_WIKIPEDIA_HANDLE') {
      replyWithWikipediaHandle(getOrCreateWikipediaHandle(), reply)
      return true
    }

    if (message.type === 'REROLL_WIKIPEDIA_HANDLE') {
      replyWithWikipediaHandle(rerollWikipediaHandle(), reply)
      return true
    }

    if (message.type === 'SET_WIKIPEDIA_HANDLE') {
      replyWithWikipediaHandle(setWikipediaHandle(message.title), reply)
      return true
    }

    if (message.type === 'UPDATE_SITE_DISCOVERY') {
      recordDiscoveredSite(message.domain).then(reply)
      return true
    }

    if (message.type === 'OPEN_TAB') {
      browser.tabs
        .create({ url: message.url })
        .then(() => reply({ success: true }))
      return true
    }

    if (message.type === 'CAPTURE_PAGE_PORTRAIT') {
      // Use the sender's window id explicitly. Without it, captureVisibleTab
      // falls back to the current focused window, which Arc's window model
      // (Spaces, Little Arc, split view) handles poorly and often returns
      // "No active web contents" on.
      const windowId = sender?.tab?.windowId
      const capture =
        windowId != null
          ? browser.tabs.captureVisibleTab(windowId, { format: 'png' })
          : // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore: captureVisibleTab overloads vary between polyfill types
            browser.tabs.captureVisibleTab({ format: 'png' })
      capture
        .then((dataUrl: string) => {
          reply({ dataUrl })
        })
        .catch((err: Error) => {
          reply({ error: err.message })
        })
      return true
    }

    if (message.type === 'STORE_EVENTS') {
      const events = (message.events || []) as CollectionEvent[]
      dedupeScrapEvents(events)
        .then((dedupedEvents) => store.addEvents(dedupedEvents))
        .then(() => {
          // A navigation focus is the canonical "user is now looking at this
          // domain" signal — the moment a domain-visit milestone could fire
          // with the right tab in front. Trigger an immediate check (cooldown
          // and debounce keep this cheap).
          const hasNavFocus = events.some(
            (e) =>
              e.type === 'navigation' && (e.data as any)?.event === 'focus',
          )
          if (hasNavFocus) scheduleMilestoneCheck()
          reply({ success: true })
        })
        .catch((e) => {
          console.error('[Background] STORE_EVENTS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'FLUSH_PENDING_UPLOADS') {
      flushPendingUploads()
        .then(() => reply({ success: true }))
        .catch((e) => {
          console.error('[Background] FLUSH_PENDING_UPLOADS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'GET_PENDING_COUNT') {
      store
        .getPendingEvents(10000)
        .then((events) => reply({ count: events.length }))
        .catch((e) => {
          console.error('[Background] GET_PENDING_COUNT error:', e)
          reply({ count: 0 })
        })
      return true
    }

    if (message.type === 'GET_RECENT_EVENTS') {
      const domain = message.domain as string
      store
        .queryByDomain(domain, { type: 'cursor', limit: 200 })
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] GET_RECENT_EVENTS error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'GET_SCRAPS') {
      const limit = (message.options?.limit ?? 5000) as number
      store
        .queryByType('element', { limit })
        .then((events) =>
          events
            .sort((first, second) => second.ts - first.ts)
            .flatMap((event): ScrapRecord[] => {
              const scrap = toScrapRecord(event)
              return scrap ? [scrap] : []
            }),
        )
        .then((scraps) => reply({ scraps }))
        .catch((e) => {
          console.error('[Background] GET_SCRAPS error:', e)
          reply({ scraps: [] })
        })
      return true
    }

    if (message.type === 'GET_DOMAIN_STATS') {
      const domain = message.domain as string
      const rawUrl = message.url as string | undefined
      const normalizedUrl = rawUrl ? normalizeUrl(rawUrl) : undefined
      const includePageSessions = message.includePageSessions === true
      ;(async () => {
        try {
          // Screen time and hour buckets are pre-computed in domain_stats (O(1)).
          // Cursor distance requires scanning cursor events (capped at 2000).
          // Page-level aggregates provide per-page time for the stats page's
          // expanded domain view (also pre-computed, key range scan).
          const [agg, cursorEvents, pageAggs] = await Promise.all([
            store.getSessionStats(domain, normalizedUrl).catch(() => null),
            queryCursorEventsForPortrait(store, domain, rawUrl),
            includePageSessions
              ? store.getPageStats(domain).catch(() => [] as never[])
              : Promise.resolve([] as never[]),
          ])

          // Only return null stats when there is truly no data at all.
          // PortraitCard interprets totalTimeMs === null as "loading" —
          // returning null here when we just have zero time would cause
          // the card to appear stuck forever.
          if (!agg && cursorEvents.length === 0) {
            reply({ success: true, stats: null })
            return
          }

          const hourBuckets = agg?.hourBuckets ?? new Array(24).fill(0)

          const cursorDistancePx = calculateCursorDistance(cursorEvents)

          // Build per-page breakdown from page-level aggregates for the stats
          // page's expanded domain view. Each page aggregate yields one entry
          // per session so computeTopPages() can sum and count correctly.
          let sessions:
            | Array<{
                url: string
                focusTs: number
                blurTs: number
                durationMs: number
              }>
            | undefined
          if (includePageSessions) {
            sessions = []
            for (const p of pageAggs) {
              const url = p.key.slice(domain.length + 2) // strip "domain::" prefix → normalizedUrl
              // Emit one synthetic session per recorded session so visit counts are accurate
              const perSessionMs =
                p.sessionCount > 0
                  ? p.totalTimeMs / p.sessionCount
                  : p.totalTimeMs
              for (let i = 0; i < Math.max(1, p.sessionCount); i++) {
                sessions.push({
                  url,
                  focusTs: p.firstVisit,
                  blurTs: p.lastVisit,
                  durationMs: perSessionMs,
                })
              }
            }
          }

          const dateRange =
            agg?.firstVisit && agg?.lastVisit
              ? {
                  oldest: new Date(agg.firstVisit).toLocaleDateString(),
                  newest: new Date(agg.lastVisit).toLocaleDateString(),
                }
              : null

          reply({
            success: true,
            stats: {
              domain,
              totalTimeMs: agg?.totalTimeMs ?? 0,
              hourBuckets,
              cursorDistancePx,
              eventCounts: agg?.eventsByType ?? {},
              dateRange,
              ...(sessions ? { sessions } : {}),
              // Only include uniquePageCount for domain-level stats (not page-level)
              uniquePageCount: normalizedUrl
                ? undefined
                : (agg?.uniqueUrlCount ?? 0),
            },
          })
        } catch (e) {
          console.error('[Background] GET_DOMAIN_STATS error:', e)
          reply({ success: false })
        }
      })()
      return true
    }

    if (message.type === 'GET_GLOBAL_STATS') {
      store
        .getGlobalStats()
        .then((agg) => {
          if (!agg) {
            reply({ success: true, stats: null })
            return
          }
          reply({
            success: true,
            stats: {
              totalTimeMs: agg.totalTimeMs,
              hourBuckets: agg.hourBuckets,
              sessionCount: agg.sessionCount,
              eventsByType: agg.eventsByType,
              firstVisit: agg.firstVisit,
              lastVisit: agg.lastVisit,
              uniqueUrlCount: agg.uniqueUrlCount,
            },
          })
        })
        .catch((e) => {
          console.error('[Background] GET_GLOBAL_STATS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'GET_STORAGE_STATS') {
      Promise.all([store.getStorageStats(), getExtensionLocalUsageBytes()])
        .then(([stats, localUsageBytes]) => {
          reply({
            success: true,
            stats: {
              ...stats,
              localUsageBytes,
            },
          })
        })
        .catch((e) => {
          console.error('[Background] GET_STORAGE_STATS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'CLEAR_ALL_EVENTS') {
      store
        .clearAll()
        .then(() => reply({ success: true }))
        .catch((e) => {
          console.error('[Background] CLEAR_ALL_EVENTS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'GET_DAY_COUNTS') {
      store
        .countEventsByDay()
        .then((counts) =>
          reply({ success: true, counts: Object.fromEntries(counts) }),
        )
        .catch((e) => {
          console.error('[Background] GET_DAY_COUNTS error:', e)
          reply({ success: false, counts: {} })
        })
      return true
    }

    if (message.type === 'GET_SCREEN_TIME') {
      const options = (message.options || {}) as Pick<
        QueryOptions,
        'startTs' | 'endTs'
      >
      store
        .getScreenTime(options)
        .then((result) => reply({ success: true, ...result }))
        .catch((e) => {
          console.error('[Background] GET_SCREEN_TIME error:', e)
          reply({
            success: false,
            error:
              e instanceof Error
                ? e.message
                : 'Local screen time is unavailable.',
            totalMs: 0,
            sessions: [],
          })
        })
      return true
    }

    if (message.type === 'GET_ALL_EVENTS') {
      const options = (message.options || {}) as QueryOptions
      store
        .getAllEvents(options)
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] GET_ALL_EVENTS error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'GET_WALKING_RECORD_EVENTS') {
      const options = (message.options || {}) as Pick<
        QueryOptions,
        'startTs' | 'endTs'
      >
      store
        .getWalkingRecordEvents(options)
        .then((result) => reply({ success: true, ...result }))
        .catch((e) => {
          console.error('[Background] GET_WALKING_RECORD_EVENTS error:', e)
          reply({
            success: false,
            error:
              e instanceof Error ? e.message : 'Local activity is unavailable.',
            events: [],
            cursorDistancePx: 0,
            activity: [],
            sessions: [],
          })
        })
      return true
    }

    if (message.type === 'GET_WALKING_RECORD_MOVEMENT') {
      const targets = (message.targets || []) as WalkingRecordTraceTarget[]
      store
        .getWalkingRecordMovement(targets)
        .then(async (movement) => ({
          ...movement,
          landscapePaths: await Promise.all(
            movement.landscapePaths.map(hydrateCursorColor),
          ),
        }))
        .then((movement) => reply({ success: true, ...movement }))
        .catch((e) => {
          console.error('[Background] GET_WALKING_RECORD_MOVEMENT error:', e)
          reply({
            success: false,
            traces: [],
            landscapePaths: [],
          })
        })
      return true
    }

    if (message.type === 'QUERY_EVENTS_BY_DOMAIN') {
      const domain = message.domain as string
      const options = (message.options || {}) as QueryOptions
      store
        .queryByDomain(domain, options)
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] QUERY_EVENTS_BY_DOMAIN error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'QUERY_EVENTS_BY_URL') {
      const url = message.url as string
      const options = (message.options || {}) as QueryOptions
      store
        .queryByUrl(url, options)
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] QUERY_EVENTS_BY_URL error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'GET_ALL_DOMAINS') {
      store
        .getAllDomains()
        .then((domains) => reply({ success: true, domains }))
        .catch((e) => {
          console.error('[Background] GET_ALL_DOMAINS error:', e)
          reply({
            success: false,
            error:
              e instanceof Error ? e.message : 'Local places are unavailable.',
            domains: [],
          })
        })
      return true
    }

    if (message.type === 'EXPORT_EVENTS') {
      ;(async () => {
        try {
          const events = await store.getAllEvents()
          const identity = await getPublicPlayerIdentity()
          const payload = JSON.stringify({
            version: 1,
            exportedAt: Date.now(),
            events,
            identity,
          })
          const compressed = await gzipString(payload)
          reply({ success: true, data: Array.from(compressed) })
        } catch (e) {
          console.error('[Background] EXPORT_EVENTS error:', e)
          reply({ success: false, error: String(e) })
        }
      })()
      return true
    }

    if (message.type === 'IMPORT_EVENTS') {
      ;(async () => {
        try {
          const json = await gunzipToString(
            new Uint8Array(message.data as number[]),
          )
          const parsed = JSON.parse(json)
          if (parsed.version !== 1)
            throw new Error('Unsupported export version')
          const events = parsed.events as CollectionEvent[]
          await store.addImportedEvents(events)
          reply({ success: true, imported: events.length })
        } catch (e) {
          console.error('[Background] IMPORT_EVENTS error:', e)
          reply({ success: false, error: String(e) })
        }
      })()
      return true
    }

    if (message.type === 'RESTORE_FROM_SERVER') {
      ;(async () => {
        try {
          const identity = await getPublicPlayerIdentity()
          const pid = identity?.publicKey
          if (!pid) {
            reply({ success: false, error: 'No player identity found' })
            return
          }
          console.log(
            '[Background] RESTORE_FROM_SERVER starting, pid:',
            pid.slice(0, 20) + '...',
            'fetching all server events',
          )
          const { events, countsByType } = await fetchEventsByPid(pid)
          console.log(
            '[Background] Fetched',
            events.length,
            'events, writing to IDB...',
          )
          await store.addRestoredEvents(events)
          console.log('[Background] RESTORE_FROM_SERVER complete')
          reply({
            success: true,
            imported: events.length,
            countsByType,
          })
        } catch (e) {
          console.error('[Background] RESTORE_FROM_SERVER error:', e)
          reply({ success: false, error: String(e) })
        }
      })()
      return true
    }
  })

  async function runMilestoneCheck() {
    let state = await loadState()
    const today = todayString()
    state = resetDailyIfNeeded(state, today)

    if (isOnCooldown(state)) return

    // Query global stats
    const globalAgg = await store.getGlobalStats()
    if (!globalAgg) return

    // Build top domains by visit count (fetch before globalStats so we can use length for domainCount)
    const allDomainEntries = await store.getAllDomains()

    const globalStats = {
      domainCount: allDomainEntries.length,
      hourBuckets: globalAgg.hourBuckets,
    }

    const activity =
      globalAgg.milestoneActivity?.localDayKey === today
        ? globalAgg.milestoneActivity
        : null
    const cursorDistancePx = activity?.cursorDistancePx ?? 0
    const dailyScreenTimeMs =
      (activity?.screenTimeMs ?? 0) +
      (activity?.pendingFocusTs
        ? Math.max(0, Date.now() - activity.pendingFocusTs)
        : 0)
    state = { ...state, dailyScreenTimeMs }

    // Build top domains by visit count
    const topDomains: Array<{
      domain: string
      visitCount: number
      faviconUrl?: string
    }> = []
    for (const domainEntry of allDomainEntries.slice(0, 20)) {
      topDomains.push({
        domain: domainEntry.domain,
        visitCount: domainEntry.sessionCount,
        ...(domainEntry.latestFaviconUrl
          ? { faviconUrl: domainEntry.latestFaviconUrl }
          : {}),
      })
    }

    const [gapTab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    const activeDomain = extractDomain(gapTab?.url ?? null)
    let longGap: Parameters<typeof checkAllMilestones>[4] = null
    if (activeDomain) {
      const domainEntry = allDomainEntries.find(
        (entry) => entry.domain === activeDomain,
      )
      const gap = detectLongGapReturn(
        domainEntry?.recentFocusVisits ?? [],
        Date.now(),
      )
      if (gap) {
        const faviconUrl = topDomains.find(
          (d) => d.domain === activeDomain,
        )?.faviconUrl
        longGap = { domain: activeDomain, faviconUrl, return: gap }
      }
    }

    const result = checkAllMilestones(
      state,
      globalStats,
      cursorDistancePx,
      topDomains,
      longGap,
    )
    if (!result) {
      await saveState(state)
      return
    }

    const { milestone, updatedState } = result

    // Only show if user is actively at their computer (idle threshold: 60s).
    // Check before saving state so we don't burn the threshold if user is away.
    if (!(await isUserActive(browser.idle))) return

    // Resolve the active tab again because it may have changed while the raw
    // event history was being queried.
    const tabs = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    const tab = tabs[0]
    if (!tab?.id) return

    // For domain-specific milestones, only deliver when the active tab is on
    // that domain — otherwise the toast's favicon and copy refer to a site
    // the user isn't currently looking at. Defer (don't burn the threshold)
    // until the next alarm tick when they're back on the domain.
    if (milestone.domain) {
      const tabDomain = extractDomain(tab.url ?? null)
      if (tabDomain !== milestone.domain) return
    }

    const finalState = recordToastShown(updatedState, today)
    await saveState(finalState)

    browser.tabs
      .sendMessage(tab.id, {
        type: 'SHOW_MILESTONE',
        milestone,
      })
      .catch(() => {
        // Tab may not have content script (new tab, chrome:// page) — ignore
      })
  }
})
