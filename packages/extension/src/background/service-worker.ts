import browser from 'webextension-polyfill'

// Extension lifecycle
browser.runtime.onInstalled.addListener((details) => {
  console.log('PlayHTML Extension installed:', details.reason)
  
  if (details.reason === 'install') {
    // First time installation - setup default identity
    initializePlayerIdentity()
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
      console.log('New player identity created')
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
  console.log('Background received message:', message, 'from:', sender.tab?.url)
  
  if (message.type === 'GET_PLAYER_IDENTITY') {
    getPlayerIdentity().then(sendResponse)
    return true // Will respond asynchronously
  }
  
  if (message.type === 'UPDATE_SITE_DISCOVERY') {
    updateSiteDiscovery(message.domain).then(sendResponse)
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
    console.log('New site discovered:', domain)
  }
}

export {}