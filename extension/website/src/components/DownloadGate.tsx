// ABOUTME: Email-gated download component for wewere.online.
// ABOUTME: Submits to worker /subscribe, then reveals Chrome/Firefox install links.

import { useState, useEffect } from 'react';
import { WORKER_URL } from '@movement/config';
import styles from './DownloadGate.module.scss';

const CHROME_DOWNLOAD_URL =
  'https://chromewebstore.google.com/detail/we-were-online/bhkdblmogjkgeipehaphdocclmijnkhc?authuser=0&hl=en';
const FIREFOX_DOWNLOAD_URL =
  'https://addons.mozilla.org/en-US/firefox/addon/we-were-online/';

const SUBSCRIBED_KEY = 'wewere.subscribed';

type GateState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; firstTime: boolean; email: string | null }
  | { status: 'error'; message: string };

interface SubscribeResponse {
  ok: boolean;
  alreadySubscribed?: boolean;
  error?: string;
}

function isLocallySubscribed(): boolean {
  try {
    return localStorage.getItem(SUBSCRIBED_KEY) === '1';
  } catch {
    return false;
  }
}

function markSubscribed(): void {
  try {
    localStorage.setItem(SUBSCRIBED_KEY, '1');
  } catch {
    // localStorage may be blocked; non-fatal
  }
}

function DownloadButtons({ size = 'default' }: { size?: 'default' | 'large' }) {
  const className =
    size === 'large'
      ? `${styles.downloadGroup} ${styles.downloadGroupLarge}`
      : styles.downloadGroup;
  return (
    <div className={className}>
      <a
        href={CHROME_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.downloadButton}
      >
        install for Chrome
      </a>
      <a
        href={FIREFOX_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.downloadButton}
      >
        install for Firefox
      </a>
    </div>
  );
}

export function DownloadGate({ size = 'default' }: { size?: 'default' | 'large' }) {
  const [state, setState] = useState<GateState>(() =>
    isLocallySubscribed()
      ? { status: 'success', firstTime: false, email: null }
      : { status: 'idle' },
  );
  const [email, setEmail] = useState('');

  // Keep multiple instances of <DownloadGate /> in sync after one of them submits.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SUBSCRIBED_KEY && e.newValue === '1') {
        setState({ status: 'success', firstTime: false, email: null });
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setState({ status: 'error', message: 'please enter an email address' });
      return;
    }

    setState({ status: 'submitting' });

    try {
      const res = await fetch(`${WORKER_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source: 'website' }),
      });
      const data = (await res.json()) as SubscribeResponse;

      if (!res.ok || !data.ok) {
        setState({
          status: 'error',
          message:
            data.error ||
            (res.status === 429
              ? 'slow down — try again in a minute'
              : 'something went wrong. try again?'),
        });
        return;
      }

      markSubscribed();
      // Notify other gates on the page (storage event only fires cross-tab; dispatch manually)
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SUBSCRIBED_KEY,
          newValue: '1',
        }),
      );
      setState({
        status: 'success',
        firstTime: !data.alreadySubscribed,
        email: trimmed,
      });
    } catch {
      setState({
        status: 'error',
        message: 'connection error. try again?',
      });
    }
  }

  if (state.status === 'success') {
    return (
      <div className={styles.gate}>
        {state.firstTime && state.email ? (
          <p className={styles.successNote}>
            sent to <strong>{state.email}</strong> — and here are the links:
          </p>
        ) : null}
        <DownloadButtons size={size} />
      </div>
    );
  }

  const submitting = state.status === 'submitting';
  const errorMessage = state.status === 'error' ? state.message : null;

  return (
    <div className={styles.gate}>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.row}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="your email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            aria-invalid={errorMessage ? 'true' : undefined}
          />
          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? 'sending…' : 'get the install links'}
          </button>
        </div>
        {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}
      </form>
      <p className={styles.subtext}>
        the extension installs on desktop. if you're on mobile, we'll email so you
        can install when you're back at a computer.
      </p>
    </div>
  );
}
