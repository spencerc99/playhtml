import React from 'react'
import { createRoot } from 'react-dom/client'

function PlayHTMLDevPanel() {
  return (
    <div>
      <h1 style={{ color: '#1f2937', marginBottom: '16px' }}>
        PlayHTML Inspector
      </h1>
      
      <section style={{ 
        background: 'white', 
        padding: '16px', 
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h2 style={{ fontSize: '16px', marginBottom: '12px', color: '#374151' }}>
          Page Analysis
        </h2>
        <p style={{ margin: 0, color: '#6b7280' }}>
          Detecting PlayHTML elements and game interactions on this page...
        </p>
      </section>

      <section style={{ 
        background: 'white', 
        padding: '16px', 
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <h2 style={{ fontSize: '16px', marginBottom: '12px', color: '#374151' }}>
          Extension State
        </h2>
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          <div>Status: Active</div>
          <div>Players detected: 0</div>
          <div>Interactive elements: 0</div>
        </div>
      </section>

      <section style={{ 
        background: 'white', 
        padding: '16px', 
        borderRadius: '8px'
      }}>
        <h2 style={{ fontSize: '16px', marginBottom: '12px', color: '#374151' }}>
          Debug Tools
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={{
              padding: '6px 12px',
              background: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Refresh State
          </button>
          <button
            style={{
              padding: '6px 12px',
              background: '#e5e7eb',
              color: '#374151',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Export Logs
          </button>
        </div>
      </section>
    </div>
  )
}

// Mount the devtools panel
const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<PlayHTMLDevPanel />)
}

export {}