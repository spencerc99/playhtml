// ABOUTME: Desktop shows install links; mobile shows an email form to send the install link.
// ABOUTME: Submission posts to worker /subscribe (with source: 'website').

import { useState, useEffect } from 'react';
import { WORKER_URL } from '@movement/config';
import styles from './DownloadGate.module.scss';

const CHROME_DOWNLOAD_URL =
  'https://chromewebstore.google.com/detail/we-were-online/bhkdblmogjkgeipehaphdocclmijnkhc?authuser=0&hl=en';
const FIREFOX_DOWNLOAD_URL =
  'https://addons.mozilla.org/en-US/firefox/addon/we-were-online/';
const EDGE_DOWNLOAD_URL =
  'https://microsoftedge.microsoft.com/addons/detail/we-were-online/kiamoecdnaglmhigmbmdkiodbbphpodl';

const DOWNLOAD_LINKS = [
  { browser: 'Chrome', url: CHROME_DOWNLOAD_URL },
  { browser: 'Firefox', url: FIREFOX_DOWNLOAD_URL },
  { browser: 'Edge', url: EDGE_DOWNLOAD_URL },
];

const SUBSCRIBED_KEY = 'wewere.subscribed';

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; firstTime: boolean; email: string }
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
      {DOWNLOAD_LINKS.map(({ browser, url }) => (
        <a
          key={browser}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.downloadButton}
        >
          install for {browser}
        </a>
      ))}
    </div>
  );
}

function MobileEmailForm() {
  const [state, setState] = useState<FormState>(() =>
    isLocallySubscribed()
      ? { status: 'success', firstTime: false, email: '' }
      : { status: 'idle' },
  );
  const [email, setEmail] = useState('');

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SUBSCRIBED_KEY && e.newValue === '1') {
        setState({ status: 'success', firstTime: false, email: '' });
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
      <p className={styles.successNote}>
        {state.firstTime && state.email ? (
          <>
            sent to <strong>{state.email}</strong>! excited to make internet feel
            more alive together :)
          </>
        ) : (
          <>install link sent — check your email :)</>
        )}
      </p>
    );
  }

  const submitting = state.status === 'submitting';
  const errorMessage = state.status === 'error' ? state.message : null;

  return (
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
          {submitting ? 'sending…' : 'download'}
        </button>
      </div>
      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}
      <p className={styles.subtext}>
        we'll email you a link so you can install on your computer
      </p>
    </form>
  );
}

export function DownloadGate({ size = 'default' }: { size?: 'default' | 'large' }) {
  return (
    <div className={styles.gate}>
      <div className={styles.desktopOnly}>
        <DownloadButtons size={size} />
      </div>
      <div className={styles.mobileOnly}>
        <MobileEmailForm />
      </div>
    </div>
  );
}
