// ABOUTME: passpals — a group chat whose rooms are formed by shared bad passwords.
// ABOUTME: Hashes the password locally, joins the matching room, and renders the chat.
import "./passpals.scss";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, usePageData, usePlayContext, usePresence } from "@playhtml/react";
import {
  colorForHandle,
  generateHandle,
  isUsablePassword,
  MAX_HANDLE_LENGTH,
  roomIdForPassword,
  sanitizeHandle,
  visitorIdForRoom,
} from "./identity";
import {
  activeTransmissions,
  Entry,
  formatAge,
  formatClock,
  makeId,
  MAX_BODY_LENGTH,
  MAX_LETTERS,
  MAX_TRANSMISSIONS,
  overflowCount,
  sanitizeBody,
  sortedLetters,
} from "./messages";

const HANDLE_STORAGE_KEY = "passpals:handle";
const VISITOR_STORAGE_KEY = "passpals:visitor";
const TYPING_IDLE_MS = 2500;

interface Session {
  roomId: string;
  password: string;
  handle: string;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A browser with storage blocked still gets a working, if forgetful, room.
  }
}

function visitorSecret(): string {
  const existing = readStored(VISITOR_STORAGE_KEY);
  if (existing) return existing;
  const minted =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : String(Math.random()).slice(2);
  writeStored(VISITOR_STORAGE_KEY, minted);
  return minted;
}

function Gate({ onEnter }: { onEnter: (session: Session) => void }) {
  const [step, setStep] = useState<"password" | "handle">("password");
  const [password, setPassword] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [handle, setHandle] = useState(
    () => readStored(HANDLE_STORAGE_KEY) || generateHandle(),
  );
  const [error, setError] = useState<string | null>(null);
  const handleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "handle") handleInputRef.current?.select();
  }, [step]);

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isUsablePassword(password)) {
      setError("type something. anything you used to use.");
      return;
    }
    setError(null);
    setRoomId(await roomIdForPassword(password));
    setStep("handle");
  };

  const submitHandle = (event: React.FormEvent) => {
    event.preventDefault();
    const cleaned = sanitizeHandle(handle);
    if (!cleaned || !roomId) {
      setError("pick a name to go by.");
      return;
    }
    writeStored(HANDLE_STORAGE_KEY, cleaned);
    onEnter({ roomId, password, handle: cleaned });
  };

  return (
    <div className="pp-gate">
      <div className="pp-card">
        <div className="pp-card-bar">
          <span>passpals</span>
          <span className="pp-card-bar-note">est. whenever</span>
        </div>
        <div className="pp-card-body">
          <p className="pp-lede">
            everyone who typed the same bad password ends up in the same room.
          </p>
          <p>
            the one you reused everywhere before you got a password manager. the
            one with your birth year on the end. type it, and you land with
            whoever else thought of it.
          </p>
          <ul className="pp-notes">
            <li>
              it never leaves this browser. it is hashed here, and only the hash
              names the room. the word at the top of the screen is drawn from
              your own typing, on your own machine.
            </li>
            <li>
              so: use an <strong>old</strong> password. not one you are still
              using.
            </li>
          </ul>

          {step === "password" ? (
            <form className="pp-form" onSubmit={submitPassword}>
              <label htmlFor="pp-password">your old bad password</label>
              <input
                id="pp-password"
                type="password"
                autoComplete="off"
                autoFocus
                value={password}
                placeholder="..."
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="submit">FIND MY PEOPLE</button>
            </form>
          ) : (
            <form className="pp-form" onSubmit={submitHandle}>
              <label htmlFor="pp-handle">go by</label>
              <input
                id="pp-handle"
                ref={handleInputRef}
                type="text"
                autoComplete="off"
                maxLength={MAX_HANDLE_LENGTH}
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
              />
              <div className="pp-form-row">
                <button
                  type="button"
                  className="pp-ghost"
                  onClick={() => setHandle(generateHandle())}
                >
                  ROLL
                </button>
                <button type="submit">GO IN</button>
              </div>
            </form>
          )}
          {error ? <p className="pp-error">{error}</p> : null}
        </div>
      </div>
      <p className="pp-colophon">
        a <a href="https://playhtml.fun/experiments/">playhtml experiment</a>
      </p>
    </div>
  );
}

interface PresencePayload extends Record<string, unknown> {
  handle: string;
  color: string;
  typing: boolean;
}

function Roster({ mine, others }: { mine: string; others: PresencePayload[] }) {
  return (
    <ul className="pp-roster">
      <li>
        <span className="pp-dot pp-dot-live" />
        <span style={{ color: colorForHandle(mine) }}>{mine}</span>
        <span className="pp-you">you</span>
      </li>
      {others.map((person) => (
        <li key={person.handle}>
          <span className="pp-dot pp-dot-live" />
          <span style={{ color: person.color }}>{person.handle}</span>
          {person.typing ? <span className="pp-typing">typing</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Room({ session }: { session: Session }) {
  const { isLoading } = usePlayContext();
  const { presences, setMyPresence } = usePresence<"passpals", PresencePayload>(
    "passpals",
  );
  const [transmissionData, setTransmissions] = usePageData<{ list: Entry[] }>(
    "passpals-transmissions",
    { list: [] },
  );
  const [letterData, setLetters] = usePageData<{ list: Entry[] }>(
    "passpals-letters",
    { list: [] },
  );
  const [arrivalData, setArrivals] = usePageData<{
    seen: Record<string, number>;
  }>("passpals-arrivals", { seen: {} });

  const [draft, setDraft] = useState("");
  const [letterDraft, setLetterDraft] = useState("");
  const [revealed, setRevealed] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const typingTimer = useRef<number | null>(null);
  const transmissionsRef = useRef<HTMLDivElement>(null);
  const arrivalsRef = useRef(arrivalData);
  arrivalsRef.current = arrivalData;

  const myColor = useMemo(
    () => colorForHandle(session.handle),
    [session.handle],
  );

  // Presence carries who is here and who is mid-sentence. It is per-connection
  // and never persisted, so writing it on every keystroke is cheap.
  const publishPresence = useCallback(
    (typing: boolean) => {
      setMyPresence({ handle: session.handle, color: myColor, typing });
    },
    [setMyPresence, session.handle, myColor],
  );

  useEffect(() => {
    if (isLoading) return;
    publishPresence(false);
  }, [isLoading, publishPresence]);

  // Count arrivals exactly once per browser per room. The id is salted with
  // the room, the write is keyed by that id, and it is skipped when the key is
  // already there — so it converges no matter how many people arrive at once.
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    void (async () => {
      const visitorId = await visitorIdForRoom(visitorSecret(), session.roomId);
      if (cancelled) return;
      if (arrivalsRef.current.seen?.[visitorId]) return;
      setArrivals((current) => {
        current.seen ??= {};
        if (!current.seen[visitorId]) current.seen[visitorId] = Date.now();
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, session.roomId, setArrivals]);

  // Drives the fade window and the letter ages without any shared writes.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const transmissions = useMemo(
    () => activeTransmissions(transmissionData.list ?? [], now),
    [transmissionData, now],
  );
  const letters = useMemo(
    () => sortedLetters(letterData.list ?? []),
    [letterData],
  );

  useEffect(() => {
    const pane = transmissionsRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [transmissions.length]);

  const others = useMemo(() => {
    const people: PresencePayload[] = [];
    for (const presence of presences.values()) {
      if (presence.isMe) continue;
      const payload = presence.passpals;
      if (!payload || typeof payload.handle !== "string") continue;
      people.push({
        handle: payload.handle,
        color: payload.color || colorForHandle(payload.handle),
        typing: Boolean(payload.typing),
      });
    }
    return people.sort((a, b) => a.handle.localeCompare(b.handle));
  }, [presences]);

  const arrivals = Math.max(
    1,
    Object.keys(arrivalData.seen ?? {}).length,
    others.length + 1,
  );

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (isLoading) return;
    publishPresence(value.trim().length > 0);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(
      () => publishPresence(false),
      TYPING_IDLE_MS,
    );
  };

  const sendTransmission = (event: React.FormEvent) => {
    event.preventDefault();
    const body = sanitizeBody(draft);
    if (!body) return;
    const entry: Entry = {
      id: makeId(),
      handle: session.handle,
      body,
      at: Date.now(),
    };
    setTransmissions((current) => {
      current.list ??= [];
      current.list.push(entry);
      const overflow = overflowCount(current.list.length, MAX_TRANSMISSIONS);
      if (overflow > 0) current.list.splice(0, overflow);
    });
    setDraft("");
    publishPresence(false);
  };

  const leaveLetter = (event: React.FormEvent) => {
    event.preventDefault();
    const body = sanitizeBody(letterDraft);
    if (!body) return;
    const entry: Entry = {
      id: makeId(),
      handle: session.handle,
      body,
      at: Date.now(),
    };
    setLetters((current) => {
      current.list ??= [];
      current.list.push(entry);
      const overflow = overflowCount(current.list.length, MAX_LETTERS);
      if (overflow > 0) current.list.splice(0, overflow);
    });
    setLetterDraft("");
  };

  const alone = others.length === 0;
  const roomHash = session.roomId.replace("passpals-", "");

  return (
    <div className="pp-shell">
      <header className="pp-titlebar">
        <span className="pp-titlebar-name">passpals</span>
        <span className="pp-titlebar-status">
          <span className={isLoading ? "pp-dot" : "pp-dot pp-dot-live"} />
          {isLoading
            ? "connecting"
            : `${others.length + 1} here now`}
        </span>
      </header>

      <div className="pp-body">
        <aside className="pp-rail">
          <section className="pp-block">
            <h2>the room</h2>
            <p className={revealed ? "pp-password" : "pp-password pp-masked"}>
              {revealed ? session.password : "•".repeat(session.password.length)}
            </p>
            <button
              type="button"
              className="pp-ghost pp-tiny"
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? "HIDE IT" : "SHOW IT"}
            </button>
            <p className="pp-hash">{roomHash}</p>
          </section>

          <section className="pp-block">
            <h2>who is here</h2>
            <Roster mine={session.handle} others={others} />
          </section>

          <section className="pp-block pp-stats">
            <p>
              <strong>{arrivals}</strong>{" "}
              {arrivals === 1 ? "person has" : "people have"} passed through
            </p>
            <p>
              <strong>{letters.length}</strong>{" "}
              {letters.length === 1 ? "letter" : "letters"} left behind
            </p>
          </section>

          <button
            type="button"
            className="pp-ghost pp-logoff"
            onClick={() => window.location.reload()}
          >
            LOG OFF
          </button>
        </aside>

        <main className="pp-pane pp-pane-chat">
          <div className="pp-pane-head">
            <h2>transmissions</h2>
            <span>fades after an hour</span>
          </div>
          <div className="pp-scroll" ref={transmissionsRef}>
            {transmissions.length === 0 ? (
              <div className="pp-empty">
                {alone ? (
                  <>
                    <p className="pp-empty-lede">
                      nobody else has typed this one.
                    </p>
                    <p>
                      not right now, anyway. anything you say here fades within
                      the hour. if you want it to still be here when the next
                      one of you shows up, leave a letter instead.
                    </p>
                  </>
                ) : (
                  <p>say something.</p>
                )}
              </div>
            ) : (
              transmissions.map((entry) => (
                <p className="pp-line" key={entry.id}>
                  <span className="pp-time">{formatClock(entry.at)}</span>
                  <span
                    className="pp-handle"
                    style={{ color: colorForHandle(entry.handle) }}
                  >
                    {entry.handle}
                  </span>
                  <span className="pp-said">{entry.body}</span>
                </p>
              ))
            )}
          </div>
          <form className="pp-composer" onSubmit={sendTransmission}>
            <span className="pp-prompt">&gt;</span>
            <input
              type="text"
              value={draft}
              maxLength={MAX_BODY_LENGTH}
              placeholder={alone ? "into the void" : "say something"}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <button type="submit">SEND</button>
          </form>
        </main>

        <aside className="pp-pane pp-pane-letters">
          <div className="pp-pane-head">
            <h2>letters</h2>
            <span>these keep</span>
          </div>
          <div className="pp-scroll">
            {letters.length === 0 ? (
              <p className="pp-empty">
                nobody has left one. you would be the first — write something
                for whoever types this password next. could be tonight, could be
                in a year.
              </p>
            ) : (
              letters.map((entry) => (
                <article className="pp-letter" key={entry.id}>
                  <p className="pp-letter-body">{entry.body}</p>
                  <p className="pp-letter-sign">
                    <span style={{ color: colorForHandle(entry.handle) }}>
                      {entry.handle}
                    </span>
                    <span className="pp-time">{formatAge(entry.at, now)}</span>
                  </p>
                </article>
              ))
            )}
          </div>
          <form className="pp-composer pp-composer-letter" onSubmit={leaveLetter}>
            <textarea
              value={letterDraft}
              rows={2}
              maxLength={MAX_BODY_LENGTH}
              placeholder="a note for the next person who types this..."
              onChange={(event) => setLetterDraft(event.target.value)}
            />
            <button type="submit">LEAVE IT</button>
          </form>
        </aside>
      </div>
    </div>
  );
}

function Passpals() {
  const [session, setSession] = useState<Session | null>(null);

  if (!session) return <Gate onEnter={setSession} />;

  return (
    <PlayProvider initOptions={{ room: session.roomId }}>
      <Room session={session} />
    </PlayProvider>
  );
}

ReactDOM.createRoot(document.getElementById("passpals") as HTMLElement).render(
  <Passpals />,
);
