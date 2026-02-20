// ABOUTME: Full-page setup wizard for first-time extension configuration
// ABOUTME: Handles name/color customization and data sharing consent
import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { getValidEventTypes } from '../shared/types';
import "./SetupPage.scss";

type Step = 'welcome' | 'customize' | 'consent' | 'done';

function CursorPreview({ color }: { color: string }) {
  return (
    <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" fill={color} />
      <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" fill={color} />
    </svg>
  );
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function randomPrimaryColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 70, 60);
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { playerIdentity } = await browser.storage.local.get(['playerIdentity']);
        if (playerIdentity) {
          setName(playerIdentity.name || '');
          const existing = playerIdentity.playerStyle?.colorPalette?.[0];
          if (existing && typeof existing === 'string') setColor(existing);
          else setColor(randomPrimaryColor());
        } else {
          setColor(randomPrimaryColor());
        }
      } catch {}
    })();
  }, []);

  const saveCustomization = async () => {
    setBusy(true);
    try {
      const { playerIdentity } = await browser.storage.local.get(['playerIdentity']);
      if (playerIdentity) {
        playerIdentity.name = name.trim() || undefined;
        if (!playerIdentity.playerStyle) playerIdentity.playerStyle = { colorPalette: [color] } as any;
        else {
          const palette = Array.isArray(playerIdentity.playerStyle.colorPalette) ? playerIdentity.playerStyle.colorPalette : [];
          palette[0] = color;
          playerIdentity.playerStyle.colorPalette = palette;
        }
        await browser.storage.local.set({ playerIdentity });
      }
      setStep('consent');
    } finally {
      setBusy(false);
    }
  };

  const applyConsent = async (mode: 'local' | 'shared') => {
    setBusy(true);
    try {
      const types = getValidEventTypes();
      const toSet: Record<string, string> = {};
      for (const t of types) toSet[`collection_mode_${t}`] = mode;
      toSet['onboarding_complete'] = 'true';
      await browser.storage.local.set(toSet);

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          for (const t of types) {
            await browser.tabs.sendMessage(tab.id, { type: 'ENABLE_COLLECTOR', collectorType: t });
          }
        }
      } catch {}

      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-page__inner">
        {step === 'welcome' && (
          <section className="setup-step">
            <h1 className="setup-step__title">we were online</h1>
            <p className="setup-step__subtitle">Help us set things up in a minute or two.</p>
            <button onClick={() => setStep('customize')} className="setup-step__btn-primary">
              Get started
            </button>
          </section>
        )}

        {step === 'customize' && (
          <section className="setup-step">
            <h2 className="setup-step__heading">Make it yours</h2>
            <div className="setup-step__field">
              <label className="setup-step__field-label">Name (optional)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Alex"
                className="setup-step__input"
              />
            </div>
            <div className="setup-step__color-row">
              <label className="setup-step__field-label">Color</label>
              <div className="setup-step__color-picker-row">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="setup-step__color-input"
                />
                <button
                  type="button"
                  aria-label="Re-roll color"
                  title="Re-roll color"
                  onClick={() => setColor(randomPrimaryColor())}
                  className="setup-step__reroll-btn"
                >
                  ↻
                </button>
                <div className="setup-step__cursor-preview">
                  <CursorPreview color={color} />
                </div>
              </div>
            </div>
            <div className="setup-step__actions">
              <button onClick={() => setStep('welcome')} className="setup-step__btn-secondary">Back</button>
              <button onClick={saveCustomization} className="setup-step__btn-primary" disabled={busy}>Continue</button>
            </div>
          </section>
        )}

        {step === 'consent' && (
          <section className="setup-step">
            <h2 className="setup-step__heading">Sharing choice</h2>
            <p className="setup-step__subtitle">Choose how your data is used. You can change this later in Settings.</p>
            <div className="setup-step__consent-actions">
              <button onClick={() => applyConsent('local')} className="setup-step__btn-private" disabled={busy}>
                Keep private (store locally)
              </button>
              <button onClick={() => applyConsent('shared')} className="setup-step__btn-collective" disabled={busy}>
                Share with the collective (anonymous)
              </button>
            </div>
            <div className="setup-step__actions">
              <button onClick={() => setStep('customize')} className="setup-step__btn-secondary">Back</button>
            </div>
          </section>
        )}

        {step === 'done' && (
          <section className="setup-step">
            <h2 className="setup-step__heading">All set!</h2>
            <p className="setup-step__subtitle">You can close this tab and open the popup to explore your portrait.</p>
            <div className="setup-step__actions">
              <button onClick={() => window.close()} className="setup-step__btn-primary">Close</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
