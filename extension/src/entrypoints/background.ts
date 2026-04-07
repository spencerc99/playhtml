// ABOUTME: Background service worker — holds the extension-origin event store and
// ABOUTME: coordinates event writes, uploads, and data reads for all extension surfaces
import browser from 'webextension-polyfill'
import { LocalEventStore } from '../storage/LocalEventStore'
import type { QueryOptions } from '../storage/LocalEventStore'
import { uploadEvents, syncParticipantColor } from '../storage/sync'
import type { CollectionEvent } from '../shared/types'
import { VERBOSE } from '../config'
import { gzipString, gunzipToString } from '../utils/dataTransfer'
import { normalizeUrl } from '../utils/urlNormalization'
import {
  loadState,
  saveState,
  todayString,
  resetDailyIfNeeded,
  isOnCooldown,
  recordToastShown,
} from '../milestones/state'
import { checkAllMilestones, pxToMiles } from '../milestones/milestones'

const store = new LocalEventStore()

async function flushPendingUploads(): Promise<void> {
  try {
    const pending = await store.getPendingEvents(100)
    if (pending.length === 0) return

    const types = Array.from(new Set(pending.map((e) => e.type)))
    const keys = types.map((t) => `collection_mode_${t}`)
    const result = await browser.storage.local.get(keys)

    const uploadable = pending.filter((e) => {
      const mode = result[`collection_mode_${e.type}`]
      const normalized: 'off' | 'local' | 'shared' =
        mode === 'off' || mode === 'shared' || mode === 'local' ? mode : 'local'
      return normalized === 'shared'
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

export default defineBackground(() => {
  // Allow content scripts to access storage.session (needed for session IDs)
  (browser.storage.session as any).setAccessLevel?.({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  }).catch(() => {});

  // Extension lifecycle
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // First time installation - setup default identity
      initializePlayerIdentity().then(() => syncIdentityToServer())
      // Open setup page in a new tab
      const url = browser.runtime.getURL('options.html')
      browser.tabs.create({ url }).catch((e) => {
        console.warn('Failed to open setup page on install', e)
      })
    } else {
      // Extension updated — ensure key is upgraded, then sync
      initializePlayerIdentity().then(() => syncIdentityToServer())
    }
  })

  // Set up 5-minute milestone check alarm
  browser.alarms.create("checkMilestones", { periodInMinutes: 5 });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "checkMilestones") return;
    await runMilestoneCheck();
  });

  // ECDSA P-256 raw public key = 65 bytes uncompressed = 130 hex chars + 'pk_' = 133 chars.
  // Old keys are 'pk_' + ~13 random chars from Math.random.
  function isOldFormatKey(publicKey: string): boolean {
    return !publicKey.startsWith('pk_') || publicKey.length < 100;
  }

  async function generateEcdsaKeypair(): Promise<{ publicKey: string; privateKey: JsonWebKey }> {
    const keypair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    const pubRaw = await crypto.subtle.exportKey('raw', keypair.publicKey);
    const pubHex = 'pk_' + Array.from(new Uint8Array(pubRaw))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const privJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey);

    return { publicKey: pubHex, privateKey: privJwk };
  }

  // Initialize player identity with ECDSA keypair, auto-upgrading old-format keys
  async function initializePlayerIdentity() {
    try {
      const existing = await browser.storage.local.get(['playerIdentity'])

      if (existing.playerIdentity && !isOldFormatKey(existing.playerIdentity.publicKey)) {
        return; // Valid ECDSA key, nothing to do
      }

      // Generate new ECDSA keypair (fresh install or upgrading old key)
      const { publicKey, privateKey } = await generateEcdsaKeypair();

      const identity = {
        publicKey,
        privateKey,
        playerStyle: existing.playerIdentity?.playerStyle ?? {
          colorPalette: [randomHslColor()],
          animationStyle: 'gentle' as const,
          interactionPatterns: []
        },
        createdAt: existing.playerIdentity?.createdAt ?? Date.now(),
        discoveredSites: existing.playerIdentity?.discoveredSites ?? []
      }

      await browser.storage.local.set({ playerIdentity: identity })
      if (VERBOSE) console.log('[Identity] Generated new ECDSA keypair, public key:', publicKey)

      // Clear legacy participant ID key so getParticipantId() reads from playerIdentity
      await browser.storage.local.remove('collection_participant_id')
    } catch (error) {
      console.error('Failed to initialize player identity:', error)
    }
  }

  function randomHslColor(): string {
    const hue = Math.floor(Math.random() * 360);
    const s = 65 + Math.floor(Math.random() * 15); // 65-80%
    const l = 55 + Math.floor(Math.random() * 15); // 55-70%
    return `hsl(${hue}, ${s}%, ${l}%)`;
  }

  // Sync participant identity (cursor color) to server on startup
  async function syncIdentityToServer() {
    try {
      const { playerIdentity } = await browser.storage.local.get(['playerIdentity']);
      if (!playerIdentity?.publicKey || !playerIdentity.playerStyle?.colorPalette?.[0]) return;
      syncParticipantColor(playerIdentity.publicKey, playerIdentity.playerStyle.colorPalette[0]);
    } catch {}
  }

  // Hydrate cursor_color onto locally-stored events from the user's identity.
  // All events in the local store are from this user (possibly under different
  // pids due to identity migration), so we apply the color unconditionally.
  async function hydrateCursorColor(events: CollectionEvent[]): Promise<CollectionEvent[]> {
    if (events.length === 0) return events
    const { playerIdentity } = await browser.storage.local.get(['playerIdentity'])
    const cursorColor = playerIdentity?.playerStyle?.colorPalette?.[0]
    if (!cursorColor) return events
    for (const evt of events) {
      evt.meta.cursor_color = cursorColor
    }
    return events
  }

  // Cross-site messaging coordination
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = sendResponse as (response?: any) => void;
    if (message.type === 'GET_PLAYER_IDENTITY') {
      getPlayerIdentity().then(reply)
      return true // Will respond asynchronously
    }

    if (message.type === 'UPDATE_SITE_DISCOVERY') {
      updateSiteDiscovery(message.domain).then(reply)
      return true
    }

    if (message.type === 'OPEN_TAB') {
      browser.tabs.create({ url: message.url }).then(() => reply({ success: true }))
      return true
    }

    if (message.type === 'CAPTURE_PAGE_PORTRAIT') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: captureVisibleTab overloads vary between polyfill types
      browser.tabs.captureVisibleTab({ format: 'png' }).then((dataUrl: string) => {
        reply({ dataUrl })
      }).catch((err: Error) => {
        reply({ error: err.message })
      })
      return true
    }

    if (message.type === 'STORE_EVENTS') {
      const events = (message.events || []) as CollectionEvent[]
      store.addEvents(events)
        .then(() => reply({ success: true }))
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
      store.getPendingEvents(10000)
        .then((events) => reply({ count: events.length }))
        .catch((e) => {
          console.error('[Background] GET_PENDING_COUNT error:', e)
          reply({ count: 0 })
        })
      return true
    }

    if (message.type === 'GET_RECENT_EVENTS') {
      const domain = message.domain as string
      store.queryByDomain(domain, { type: 'cursor', limit: 200 })
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] GET_RECENT_EVENTS error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'GET_DOMAIN_STATS') {
      const domain = message.domain as string
      const rawUrl = message.url as string | undefined
      const normalizedUrl = rawUrl ? normalizeUrl(rawUrl) : undefined
      ;(async () => {
        try {
          // Screen time and hour buckets are pre-computed in domain_stats (O(1)).
          // Cursor distance requires scanning cursor events (capped at 2000).
          // Page-level aggregates provide per-page time for the stats page's
          // expanded domain view (also pre-computed, key range scan).
          const [agg, cursorEvents, pageAggs] = await Promise.all([
            store.getSessionStats(domain, normalizedUrl).catch(() => null),
            store.queryByDomain(domain, { type: 'cursor', limit: 2000 }),
            store.getPageStats(domain).catch(() => [] as never[]),
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

          // Compute cursor distance: sum of Euclidean distances between consecutive move samples
          // Normalized positions (0-1) are scaled by assumed 1920×1080 viewport
          const moveEvents = cursorEvents
            .filter((e) => (e.data as any).event === 'move')
            .sort((a, b) => a.ts - b.ts)
          let cursorDistancePx = 0
          for (let i = 1; i < moveEvents.length; i++) {
            const prev = moveEvents[i - 1].data as any
            const curr = moveEvents[i].data as any
            const dx = (curr.x - prev.x) * 1920
            const dy = (curr.y - prev.y) * 1080
            cursorDistancePx += Math.sqrt(dx * dx + dy * dy)
          }

          // Build per-page breakdown from page-level aggregates for the stats
          // page's expanded domain view. Each page aggregate yields one entry
          // per session so computeTopPages() can sum and count correctly.
          const sessions: Array<{ url: string; focusTs: number; blurTs: number; durationMs: number }> = []
          for (const p of pageAggs) {
            const url = p.key.slice(domain.length + 2) // strip "domain::" prefix → normalizedUrl
            // Emit one synthetic session per recorded session so visit counts are accurate
            const perSessionMs = p.sessionCount > 0 ? p.totalTimeMs / p.sessionCount : p.totalTimeMs
            for (let i = 0; i < Math.max(1, p.sessionCount); i++) {
              sessions.push({
                url,
                focusTs: p.firstVisit,
                blurTs: p.lastVisit,
                durationMs: perSessionMs,
              })
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
              sessions,
              // Only include uniquePageCount for domain-level stats (not page-level)
              uniquePageCount: normalizedUrl ? undefined : (agg?.uniqueUrls?.length ?? 0),
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
      store.getGlobalStats()
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
              uniqueUrlCount: agg.uniqueUrls.length,
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
      store.getStorageStats()
        .then((stats) => reply({ success: true, stats }))
        .catch((e) => {
          console.error('[Background] GET_STORAGE_STATS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'CLEAR_ALL_EVENTS') {
      store.clearAll()
        .then(() => reply({ success: true }))
        .catch((e) => {
          console.error('[Background] CLEAR_ALL_EVENTS error:', e)
          reply({ success: false })
        })
      return true
    }

    if (message.type === 'GET_DAY_COUNTS') {
      store.countEventsByDay()
        .then((counts) => reply({ success: true, counts: Object.fromEntries(counts) }))
        .catch((e) => {
          console.error('[Background] GET_DAY_COUNTS error:', e)
          reply({ success: false, counts: {} })
        })
      return true
    }

    if (message.type === 'GET_SCREEN_TIME') {
      const options = (message.options || {}) as Pick<QueryOptions, 'startTs' | 'endTs'>
      store.getScreenTime(options)
        .then((result) => reply({ success: true, ...result }))
        .catch((e) => {
          console.error('[Background] GET_SCREEN_TIME error:', e)
          reply({ success: false, totalMs: 0, sessions: [], totalScrollDistancePx: 0 })
        })
      return true
    }

    if (message.type === 'GET_ALL_EVENTS') {
      const options = (message.options || {}) as QueryOptions
      store.getAllEvents(options)
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] GET_ALL_EVENTS error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'QUERY_EVENTS_BY_DOMAIN') {
      const domain = message.domain as string
      const options = (message.options || {}) as QueryOptions
      store.queryByDomain(domain, options)
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
      store.queryByUrl(url, options)
        .then(hydrateCursorColor)
        .then((events) => reply({ success: true, events }))
        .catch((e) => {
          console.error('[Background] QUERY_EVENTS_BY_URL error:', e)
          reply({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'GET_ALL_DOMAINS') {
      store.getAllDomains()
        .then((domains) => reply({ success: true, domains }))
        .catch((e) => {
          console.error('[Background] GET_ALL_DOMAINS error:', e)
          reply({ success: false, domains: [] })
        })
      return true
    }

    if (message.type === 'EXPORT_EVENTS') {
      ;(async () => {
        try {
          const events = await store.getAllEvents()
          const identity = await getPlayerIdentity()
          const payload = JSON.stringify({ version: 1, exportedAt: Date.now(), events, identity })
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
          const json = await gunzipToString(new Uint8Array(message.data as number[]))
          const parsed = JSON.parse(json)
          if (parsed.version !== 1) throw new Error('Unsupported export version')
          const events = parsed.events as CollectionEvent[]
          await store.addEvents(events)
          reply({ success: true, imported: events.length })
        } catch (e) {
          console.error('[Background] IMPORT_EVENTS error:', e)
          reply({ success: false, error: String(e) })
        }
      })()
      return true
    }
  })

  async function getPlayerIdentity() {
    const { playerIdentity } = await browser.storage.local.get(['playerIdentity'])
    return playerIdentity
  }

  async function updateSiteDiscovery(domain: string) {
    const { playerIdentity } = await browser.storage.local.get(['playerIdentity'])

    if (playerIdentity && !playerIdentity.discoveredSites.includes(domain)) {
      playerIdentity.discoveredSites.push(domain)
      await browser.storage.local.set({ playerIdentity })
    }
  }

  async function runMilestoneCheck() {
    let state = await loadState();
    const today = todayString();
    state = resetDailyIfNeeded(state, today);

    if (isOnCooldown(state)) return;

    // Query global stats
    const globalAgg = await store.getGlobalStats();
    if (!globalAgg) return;

    const globalStats = {
      totalTimeMs: globalAgg.totalTimeMs,
      uniqueUrlCount: globalAgg.uniqueUrls.length,
      hourBuckets: globalAgg.hourBuckets,
    };

    // Query cursor distance for today
    const midnightTs = new Date();
    midnightTs.setHours(0, 0, 0, 0);
    const cursorEvents = await store.getAllEvents({ type: 'cursor', startTs: midnightTs.getTime(), limit: 5000 });
    const moveEvents = cursorEvents
      .filter((e) => (e.data as any).event === 'move')
      .sort((a, b) => a.ts - b.ts);
    let cursorDistancePx = 0;
    for (let i = 1; i < moveEvents.length; i++) {
      const prev = moveEvents[i - 1].data as any;
      const curr = moveEvents[i].data as any;
      const dx = (curr.x - prev.x) * 1920;
      const dy = (curr.y - prev.y) * 1080;
      cursorDistancePx += Math.sqrt(dx * dx + dy * dy);
    }

    // Build top domains by visit count
    const allDomainEntries = await store.getAllDomains();
    const topDomains: Array<{ domain: string; visitCount: number; faviconUrl?: string }> = [];
    for (const { domain } of allDomainEntries.slice(0, 20)) {
      const agg = await store.getSessionStats(domain).catch(() => null);
      if (!agg) continue;
      const navEvents = await store.queryByDomain(domain, { type: 'navigation', limit: 1 });
      const faviconUrl = navEvents[0]
        ? (navEvents[0].data as any).favicon_url
        : undefined;
      topDomains.push({ domain, visitCount: agg.sessionCount, faviconUrl });
    }

    const result = checkAllMilestones(state, globalStats, cursorDistancePx, topDomains);
    if (!result) {
      await saveState(state);
      return;
    }

    const { milestone, updatedState } = result;

    // Only show if user is actively at their computer (idle threshold: 60s).
    // Check before saving state so we don't burn the threshold if user is away.
    const idleState = await browser.idle.queryState(60);
    if (idleState !== "active") return;

    const finalState = recordToastShown(updatedState, today);
    await saveState(finalState);

    // Send to active tab. Use lastFocusedWindow rather than currentWindow so
    // this works even when DevTools is the focused window.
    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;
    browser.tabs.sendMessage(tab.id, {
      type: 'SHOW_MILESTONE',
      milestone,
    }).catch(() => {
      // Tab may not have content script (new tab, chrome:// page) — ignore
    });
  }
});
