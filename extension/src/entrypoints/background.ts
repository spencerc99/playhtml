import browser from 'webextension-polyfill'

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
            colorPalette: ['#6366f1', '#8b5cf6', '#ec4899'],
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
