import browser from 'webextension-polyfill'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main() {
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
        
        return existingElements.length
      }

      public checkPlayHTMLStatus() {
        const existingElements = document.querySelectorAll('[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]')
        return {
          elementCount: existingElements.length,
          detected: existingElements.length > 0
        }
      }

      private setupElementPicker() {
        // Element picker will be activated on demand
        console.log('Element picker ready')
      }

      private findAppropriateTarget(element: HTMLElement): HTMLElement | null {
        // Skip elements that are too large (likely containers)
        const rect = element.getBoundingClientRect()
        const viewportArea = window.innerWidth * window.innerHeight
        const elementArea = rect.width * rect.height
        
        // Skip if element takes up more than 50% of viewport
        if (elementArea > viewportArea * 0.5) {
          // Try to find a smaller child element instead
          return this.findSmallerChild(element)
        }
        
        // Skip structural elements that are typically containers
        const structuralTags = ['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE', 'ASIDE']
        if (structuralTags.includes(element.tagName)) {
          return this.findSmallerChild(element)
        }
        
        // Skip very large container-like elements
        if (rect.width > window.innerWidth * 0.8 || rect.height > window.innerHeight * 0.6) {
          return this.findSmallerChild(element)
        }
        
        // Skip elements that are too small to be meaningful
        if (rect.width < 20 || rect.height < 20) {
          return this.findLargerParent(element)
        }
        
        // Skip elements that already have PlayHTML capabilities
        const playhtmlAttrs = ['can-move', 'can-spin', 'can-toggle', 'can-grow', 'can-duplicate', 'can-mirror', 'can-play']
        if (playhtmlAttrs.some(attr => element.hasAttribute(attr))) {
          return null
        }
        
        return element
      }

      private findSmallerChild(element: HTMLElement): HTMLElement | null {
        // Look for meaningful child elements that are smaller
        const children = Array.from(element.children) as HTMLElement[]
        
        for (const child of children) {
          const childRect = child.getBoundingClientRect()
          const viewportArea = window.innerWidth * window.innerHeight
          const childArea = childRect.width * childRect.height
          
          // If child is a reasonable size, use it
          if (childArea < viewportArea * 0.3 && childRect.width >= 20 && childRect.height >= 20) {
            // Recursively check if this child is appropriate
            const appropriateChild = this.findAppropriateTarget(child)
            if (appropriateChild) return appropriateChild
          }
        }
        
        return null
      }

      private findLargerParent(element: HTMLElement): HTMLElement | null {
        let parent = element.parentElement
        
        while (parent && parent !== document.body) {
          const rect = parent.getBoundingClientRect()
          
          // If parent is reasonably sized, use it
          if (rect.width >= 50 && rect.height >= 50 && rect.width < window.innerWidth * 0.5) {
            const appropriateParent = this.findAppropriateTarget(parent)
            if (appropriateParent === parent) return parent
          }
          
          parent = parent.parentElement
        }
        
        return element // fallback to original if no better parent found
      }

      public activateElementPicker() {
        console.log('Activating element picker...')
        
        // Create overlay for element selection
        const overlay = document.createElement('div')
        overlay.id = 'playhtml-picker-overlay'
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(99, 102, 241, 0.1);
          z-index: 999999;
          cursor: crosshair;
          pointer-events: none;
        `
        
        const highlight = document.createElement('div')
        highlight.id = 'playhtml-picker-highlight'
        highlight.style.cssText = `
          position: absolute;
          border: 2px solid #6366f1;
          background: rgba(99, 102, 241, 0.2);
          pointer-events: none;
          z-index: 1000000;
          border-radius: 4px;
          transition: all 0.1s ease;
        `
        
        document.body.appendChild(overlay)
        document.body.appendChild(highlight)
        
        // Track mouse movement and highlight elements
        let isActive = true
        
        const handleMouseMove = (e: MouseEvent) => {
          if (!isActive) return
          
          const target = document.elementFromPoint(e.clientX, e.clientY)
          if (!target || target === overlay || target === highlight) return
          
          // Find the most appropriate target element
          const appropriateTarget = this.findAppropriateTarget(target as HTMLElement)
          
          if (!appropriateTarget) {
            // Show red highlight for invalid targets
            const rect = target.getBoundingClientRect()
            highlight.style.left = `${rect.left}px`
            highlight.style.top = `${rect.top}px`
            highlight.style.width = `${rect.width}px`
            highlight.style.height = `${rect.height}px`
            highlight.style.borderColor = '#ef4444'
            highlight.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
            return
          }
          
          // Show blue highlight for valid targets
          const rect = appropriateTarget.getBoundingClientRect()
          highlight.style.left = `${rect.left}px`
          highlight.style.top = `${rect.top}px`
          highlight.style.width = `${rect.width}px`
          highlight.style.height = `${rect.height}px`
          highlight.style.borderColor = '#6366f1'
          highlight.style.backgroundColor = 'rgba(99, 102, 241, 0.2)'
        }
        
        const handleClick = (e: MouseEvent) => {
          if (!isActive) return
          
          e.preventDefault()
          e.stopPropagation()
          
          const target = document.elementFromPoint(e.clientX, e.clientY)
          if (!target || target === overlay || target === highlight) return
          
          // Find the most appropriate target element
          const appropriateTarget = this.findAppropriateTarget(target as HTMLElement)
          if (!appropriateTarget) return
          
          // Show capability selection modal
          this.showCapabilityModal(appropriateTarget)
          
          // Clean up
          isActive = false
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('click', handleClick)
          document.removeEventListener('keydown', handleEscape)
          overlay.remove()
          highlight.remove()
        }
        
        const handleEscape = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            isActive = false
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('click', handleClick)
            document.removeEventListener('keydown', handleEscape)
            overlay.remove()
            highlight.remove()
          }
        }
        
        // Enable pointer events for clicking
        setTimeout(() => {
          overlay.style.pointerEvents = 'auto'
        }, 100)
        
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('click', handleClick, true)
        document.addEventListener('keydown', handleEscape)
      }

      private showCapabilityModal(element: HTMLElement) {
        // Create modal for selecting capabilities
        const modal = document.createElement('div')
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 24px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
          z-index: 1000001;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 400px;
        `
        
        const capabilities = [
          { name: 'can-move', description: 'Make element draggable' },
          { name: 'can-spin', description: 'Make element rotatable' },
          { name: 'can-toggle', description: 'Add toggle on/off state' },
          { name: 'can-grow', description: 'Make element scalable' },
          { name: 'can-duplicate', description: 'Allow element cloning' }
        ]
        
        modal.innerHTML = `
          <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #1f2937;">
            Add PlayHTML Capability
          </h3>
          <p style="margin: 0 0 16px 0; font-size: 14px; color: #6b7280;">
            Choose a capability to add to this element:
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${capabilities.map(cap => `
              <button 
                data-capability="${cap.name}" 
                style="
                  padding: 12px; 
                  border: 1px solid #d1d5db; 
                  border-radius: 6px; 
                  background: white; 
                  cursor: pointer;
                  text-align: left;
                  transition: background-color 0.2s;
                "
                onmouseover="this.style.backgroundColor='#f9fafb'"
                onmouseout="this.style.backgroundColor='white'"
              >
                <strong>${cap.name}</strong><br>
                <span style="font-size: 12px; color: #6b7280;">${cap.description}</span>
              </button>
            `).join('')}
          </div>
          <div style="margin-top: 16px; display: flex; gap: 8px;">
            <button id="playhtml-cancel" style="
              flex: 1; 
              padding: 8px 16px; 
              border: 1px solid #d1d5db; 
              border-radius: 6px; 
              background: white; 
              cursor: pointer;
            ">Cancel</button>
          </div>
        `
        
        // Create backdrop
        const backdrop = document.createElement('div')
        backdrop.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000000;
        `
        
        document.body.appendChild(backdrop)
        document.body.appendChild(modal)
        
        // Handle capability selection
        modal.addEventListener('click', (e) => {
          const target = e.target as HTMLElement
          if (target.dataset.capability) {
            this.applyCapability(element, target.dataset.capability)
            backdrop.remove()
            modal.remove()
          }
          if (target.id === 'playhtml-cancel') {
            backdrop.remove()
            modal.remove()
          }
        })
        
        backdrop.addEventListener('click', () => {
          backdrop.remove()
          modal.remove()
        })
      }

      private applyCapability(element: HTMLElement, capability: string) {
        // Generate unique ID if element doesn't have one
        if (!element.id) {
          element.id = `playhtml-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        }
        
        // Add the capability attribute
        element.setAttribute(capability, '')
        
        console.log(`Applied ${capability} to element:`, element)
        
        // TODO: Initialize PlayHTML on this element
        // TODO: Sync with backend if available
        
        // Show success notification
        this.showNotification(`Added ${capability} to element!`)
      }

      private showNotification(message: string) {
        const notification = document.createElement('div')
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #10b981;
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          z-index: 1000001;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        `
        notification.textContent = message
        
        document.body.appendChild(notification)
        
        setTimeout(() => {
          notification.style.opacity = '0'
          notification.style.transition = 'opacity 0.3s ease'
          setTimeout(() => notification.remove(), 300)
        }, 3000)
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
    let extensionInstance: PlayHTMLExtension | null = null
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        extensionInstance = new PlayHTMLExtension()
        extensionInstance.init()
      })
    } else {
      extensionInstance = new PlayHTMLExtension()
      extensionInstance.init()
    }

    // Listen for messages from popup/devtools
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message)
      
      if (message.type === 'PING') {
        sendResponse({ status: 'pong', url: window.location.href })
        return
      }
      
      if (message.type === 'CHECK_PLAYHTML_STATUS') {
        const status = extensionInstance?.checkPlayHTMLStatus() || {
          elementCount: 0,
          detected: false
        }
        sendResponse(status)
        return
      }
      
      if (message.type === 'ACTIVATE_ELEMENT_PICKER') {
        extensionInstance?.activateElementPicker()
        sendResponse({ success: true })
        return
      }
    })
  }
});