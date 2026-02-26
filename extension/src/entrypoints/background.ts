// ABOUTME: Background service worker — holds the extension-origin event store and
// ABOUTME: coordinates event writes, uploads, and data reads for all extension surfaces
import browser from 'webextension-polyfill'
import { LocalEventStore } from '../storage/LocalEventStore'
import type { QueryOptions } from '../storage/LocalEventStore'
import { uploadEvents } from '../storage/sync'
import type { CollectionEvent } from '../shared/types'

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
  // Extension lifecycle
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // First time installation - setup default identity
      initializePlayerIdentity()
      // Open setup page in a new tab
      const url = browser.runtime.getURL('options.html')
      browser.tabs.create({ url }).catch((e) => {
        console.warn('Failed to open setup page on install', e)
      })
    }
  })

  // Initialize player identity and game state
  async function initializePlayerIdentity() {
    try {
      const existingIdentity = await browser.storage.local.get(['playerIdentity'])

      if (!existingIdentity.playerIdentity) {
        // Generate new identity
        const identity = {
          publicKey: generatePublicKey(),
          privateKey: generatePrivateKey(),
          playerStyle: {
            colorPalette: [randomHslColor()],
            animationStyle: 'gentle' as const,
            interactionPatterns: []
          },
          createdAt: Date.now(),
          discoveredSites: []
        }

        await browser.storage.local.set({ playerIdentity: identity })
      }
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

  // Simple key generation (will be replaced with proper crypto)
  function generatePublicKey(): string {
    return 'pk_' + Math.random().toString(36).substring(2, 15)
  }

  function generatePrivateKey(): string {
    return 'sk_' + Math.random().toString(36).substring(2, 15)
  }

  // Cross-site messaging coordination
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PLAYER_IDENTITY') {
      getPlayerIdentity().then(sendResponse)
      return true // Will respond asynchronously
    }

    if (message.type === 'UPDATE_SITE_DISCOVERY') {
      updateSiteDiscovery(message.domain).then(sendResponse)
      return true
    }

    if (message.type === 'OPEN_TAB') {
      browser.tabs.create({ url: message.url }).then(() => sendResponse({ success: true }))
      return true
    }

    if (message.type === 'CAPTURE_PAGE_PORTRAIT') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: captureVisibleTab overloads vary between polyfill types
      browser.tabs.captureVisibleTab({ format: 'png' }).then((dataUrl: string) => {
        sendResponse({ dataUrl })
      }).catch((err: Error) => {
        sendResponse({ error: err.message })
      })
      return true
    }

    if (message.type === 'STORE_EVENTS') {
      const events = (message.events || []) as CollectionEvent[]
      store.addEvents(events)
        .then(() => sendResponse({ success: true }))
        .catch((e) => {
          console.error('[Background] STORE_EVENTS error:', e)
          sendResponse({ success: false })
        })
      return true
    }

    if (message.type === 'FLUSH_PENDING_UPLOADS') {
      flushPendingUploads()
        .then(() => sendResponse({ success: true }))
        .catch((e) => {
          console.error('[Background] FLUSH_PENDING_UPLOADS error:', e)
          sendResponse({ success: false })
        })
      return true
    }

    if (message.type === 'GET_PENDING_COUNT') {
      store.getPendingEvents(10000)
        .then((events) => sendResponse({ count: events.length }))
        .catch((e) => {
          console.error('[Background] GET_PENDING_COUNT error:', e)
          sendResponse({ count: 0 })
        })
      return true
    }

    if (message.type === 'GET_RECENT_EVENTS') {
      const domain = message.domain as string
      store.queryByDomain(domain, { type: 'cursor', limit: 200 })
        .then((events) => sendResponse({ success: true, events }))
        .catch((e) => {
          console.error('[Background] GET_RECENT_EVENTS error:', e)
          sendResponse({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'GET_DOMAIN_STATS') {
      const domain = message.domain as string
      ;(async () => {
        try {
          const domainStats = await store.getDomainStats(domain)
          if (domainStats.totalEvents === 0) {
            sendResponse({ success: true, stats: null })
            return
          }

          const events = await store.queryByDomain(domain)

          const uniqueUrls = new Set(events.map((e) => e.meta.url).filter(Boolean))

          const counts = { cursor: 0, keyboard: 0, viewport: 0 }
          events.forEach((e) => {
            if (e.type === 'cursor') counts.cursor++
            else if (e.type === 'keyboard') counts.keyboard++
            else if (e.type === 'viewport') counts.viewport++
          })

          const navEvents = events
            .filter((e) => e.type === 'navigation')
            .sort((a, b) => a.ts - b.ts)
          let pendingFocusTs: number | null = null
          let pendingFocusUrl = ''
          let totalTimeMs = 0
          const sessions: { url: string; focusTs: number; blurTs: number; durationMs: number }[] = []
          for (const evt of navEvents) {
            const d = evt.data as any
            if (d.event === 'focus') {
              pendingFocusTs = evt.ts
              pendingFocusUrl = evt.meta?.url ?? ''
            } else if ((d.event === 'blur' || d.event === 'beforeunload') && pendingFocusTs !== null) {
              const durationMs = evt.ts - pendingFocusTs
              if (durationMs >= 1000 && durationMs <= 8 * 60 * 60 * 1000) {
                totalTimeMs += durationMs
                sessions.push({ url: pendingFocusUrl, focusTs: pendingFocusTs, blurTs: evt.ts, durationMs })
              }
              pendingFocusTs = null
            }
          }

          // Compute cursor distance: sum of Euclidean distances between consecutive move samples
          // Normalized positions (0-1) are scaled by assumed 1920×1080 viewport
          const cursorEvents = events
            .filter((e) => e.type === 'cursor' && (e.data as any).event === 'move')
            .sort((a, b) => a.ts - b.ts)
          let cursorDistancePx = 0
          for (let i = 1; i < cursorEvents.length; i++) {
            const prev = cursorEvents[i - 1].data as any
            const curr = cursorEvents[i].data as any
            const dx = (curr.x - prev.x) * 1920
            const dy = (curr.y - prev.y) * 1080
            cursorDistancePx += Math.sqrt(dx * dx + dy * dy)
          }

          const dateRange =
            domainStats.firstVisit && domainStats.lastVisit
              ? {
                  oldest: new Date(domainStats.firstVisit).toLocaleDateString(),
                  newest: new Date(domainStats.lastVisit).toLocaleDateString(),
                }
              : null

          sendResponse({
            success: true,
            stats: {
              domain,
              totalTimeMs: totalTimeMs > 0 ? totalTimeMs : null,
              sessions,
              cursorDistancePx,
              eventCounts: counts,
              dateRange,
              uniquePageCount: uniqueUrls.size,
            },
          })
        } catch (e) {
          console.error('[Background] GET_DOMAIN_STATS error:', e)
          sendResponse({ success: false })
        }
      })()
      return true
    }

    if (message.type === 'GET_STORAGE_STATS') {
      store.getStorageStats()
        .then((stats) => sendResponse({ success: true, stats }))
        .catch((e) => {
          console.error('[Background] GET_STORAGE_STATS error:', e)
          sendResponse({ success: false })
        })
      return true
    }

    if (message.type === 'CLEAR_ALL_EVENTS') {
      store.clearAll()
        .then(() => sendResponse({ success: true }))
        .catch((e) => {
          console.error('[Background] CLEAR_ALL_EVENTS error:', e)
          sendResponse({ success: false })
        })
      return true
    }

    if (message.type === 'GET_ALL_EVENTS') {
      const options = (message.options || {}) as QueryOptions
      store.getAllEvents(options)
        .then((events) => sendResponse({ success: true, events }))
        .catch((e) => {
          console.error('[Background] GET_ALL_EVENTS error:', e)
          sendResponse({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'QUERY_EVENTS_BY_DOMAIN') {
      const domain = message.domain as string
      const options = (message.options || {}) as QueryOptions
      store.queryByDomain(domain, options)
        .then((events) => sendResponse({ success: true, events }))
        .catch((e) => {
          console.error('[Background] QUERY_EVENTS_BY_DOMAIN error:', e)
          sendResponse({ success: false, events: [] })
        })
      return true
    }

    if (message.type === 'QUERY_EVENTS_BY_URL') {
      const url = message.url as string
      const options = (message.options || {}) as QueryOptions
      store.queryByUrl(url, options)
        .then((events) => sendResponse({ success: true, events }))
        .catch((e) => {
          console.error('[Background] QUERY_EVENTS_BY_URL error:', e)
          sendResponse({ success: false, events: [] })
        })
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
});
