import browser from 'webextension-polyfill'

console.log('PlayHTML Extension content script loaded on:', window.location.href)

// Initialize PlayHTML extension on page
class PlayHTMLExtension {
  private playerIdentity: any = null
  private isInitialized = false

  async init() {
    if (this.isInitialized) return
    
    try {
      // Get player identity from background script
      this.playerIdentity = await browser.runtime.sendMessage({ 
        type: 'GET_PLAYER_IDENTITY' 
      })
      
      // Notify background about site discovery
      await browser.runtime.sendMessage({
        type: 'UPDATE_SITE_DISCOVERY',
        domain: window.location.hostname
      })
      
      // Check if page already has PlayHTML
      this.detectExistingPlayHTML()
      
      // Initialize extension features
      this.setupElementPicker()
      this.setupPresenceDetection()
      
      this.isInitialized = true
      console.log('PlayHTML Extension initialized with identity:', this.playerIdentity?.publicKey)
      
    } catch (error) {
      console.error('Failed to initialize PlayHTML Extension:', error)
    }
  }

  private detectExistingPlayHTML() {
    // Look for existing PlayHTML elements
    const existingElements = document.querySelectorAll('[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]')
    
    if (existingElements.length > 0) {
      console.log('Existing PlayHTML detected:', existingElements.length, 'elements')
      // TODO: Coordinate with existing PlayHTML instance
    } else {
      console.log('No existing PlayHTML detected - extension has full control')
    }
  }

  private setupElementPicker() {
    // TODO: Implement visual element selection tool
    console.log('Element picker ready')
  }

  private setupPresenceDetection() {
    // TODO: Implement real-time presence with other players
    console.log('Presence detection active')
    
    // Simple cursor tracking for now
    document.addEventListener('mousemove', (e) => {
      // Throttled cursor position updates will go here
    })
  }
}

// Initialize extension when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const extension = new PlayHTMLExtension()
    extension.init()
  })
} else {
  const extension = new PlayHTMLExtension()
  extension.init()
}

// Listen for messages from popup/devtools
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message)
  
  if (message.type === 'PING') {
    sendResponse({ status: 'pong', url: window.location.href })
  }
})

export {}