// ABOUTME: First-run onboarding screen shown before main popup view
// ABOUTME: Explains data collection and captures the user's sharing preference
import React from 'react';
import browser from 'webextension-polyfill';
import { getValidEventTypes } from '../shared/types';
import "./Onboarding.scss";

interface Props {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: Props) {
  const applyChoice = async (mode: 'local' | 'shared') => {
    const types = getValidEventTypes();

    // Persist per-collector modes
    const toSet: Record<string, string> = {};
    for (const t of types) {
      toSet[`collection_mode_${t}`] = mode;
    }
    toSet['onboarding_complete'] = 'true';
    await browser.storage.local.set(toSet);

    try {
      // Enable/disable collectors based on selected mode (off not used here)
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        for (const t of types) {
          if (mode === 'local' || mode === 'shared') {
            await browser.tabs.sendMessage(tab.id, { type: 'ENABLE_COLLECTOR', collectorType: t });
          }
        }
      }
    } catch (e) {
      // Non-fatal; content script may be unavailable on some pages
    }

    onComplete();
  };

  return (
    <div className="onboarding">
      <header className="onboarding__header">
        <h1 className="onboarding__title">we were online</h1>
        <p className="onboarding__subtitle">
          A living portrait made from your browsing movements.
        </p>
      </header>

      <main className="onboarding__main">
        <section className="onboarding__section">
          <h3>What we collect</h3>
          <ul>
            <li>Cursor movement and clicks</li>
            <li>Keyboard typing cadence and input locations</li>
            <li>Viewport scroll, resize, and zoom</li>
            <li>Navigation and tab visibility</li>
          </ul>
        </section>

        <section className="onboarding__choice-card">
          <h3>Sharing choice</h3>
          <p>Choose how your data is used. You can change this anytime in Settings.</p>
          <button onClick={() => applyChoice('local')} className="onboarding__btn-private">
            Keep private (store locally)
          </button>
          <button onClick={() => applyChoice('shared')} className="onboarding__btn-collective">
            Share with the collective (anonymous)
          </button>
        </section>
      </main>

      <footer className="onboarding__footer">
        You can switch modes later in Collections.
      </footer>
    </div>
  );
}
