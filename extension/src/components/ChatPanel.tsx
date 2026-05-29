// ABOUTME: Floating AIM-style chat panel rendered above the Wikipedia presence pill.
// ABOUTME: Pure presentational React — receives messages and handlers from ChatManager.

import { useEffect, useRef, useState } from "react";
import type { ChatMessageView } from "../features/ChatManager";
import { WikiArticleLink } from "./WikiArticleLink";

interface ChatPanelProps {
  messages: ChatMessageView[];
  handle: string;
  myColor: string;
  articleTitle: string;
  currentArticleName: string | null;
  sendError: string | null;
  focusNonce: number;
  onSend: (text: string) => void;
  onClose: () => void;
  onReroll: () => void;
  onUsePage: () => void;
  onClearError: () => void;
}

const MAX_MESSAGE_LENGTH = 400;
const SOFT_COUNTER_AT = 380;

export function ChatPanel({
  messages,
  handle,
  myColor,
  articleTitle,
  currentArticleName,
  sendError,
  focusNonce,
  onSend,
  onClose,
  onReroll,
  onUsePage,
  onClearError,
}: ChatPanelProps) {
  const [value, setValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus the input whenever the manager bumps the nonce (e.g. "/" pressed
  // while the panel is open but the input isn't focused).
  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function attemptSend() {
    const v = value.trim();
    if (v.length === 0) return;
    onSend(value);
    setValue("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      attemptSend();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value.slice(0, MAX_MESSAGE_LENGTH);
    setValue(next);
    if (sendError) onClearError();
  }

  const showCounter = value.length >= SOFT_COUNTER_AT;

  return (
    <div className="chat-panel" role="dialog" aria-label={`chat for ${articleTitle}`}>
      <div className="chat-titlebar">
        <span className="chat-title-text">chatting on {articleTitle}</span>
        <button
          type="button"
          className="chat-close"
          aria-label="minimize chat"
          title="minimize"
          onClick={onClose}
        >
          –
        </button>
      </div>
      <div className="chat-name-strip">
        <span className="you-dot" style={{ background: myColor }} />
        <span className="you-label">
          chatting as{" "}
          {handle === "Anonymous" ? (
            <strong>{handle}</strong>
          ) : (
            <WikiArticleLink className="chat-handle-link" title={handle} />
          )}
        </span>
        <span className="chat-name-actions">
          {currentArticleName && handle !== currentArticleName ? (
            <button
              type="button"
              className="chat-be-page"
              onClick={onUsePage}
              aria-label="be this page"
              title="be this page"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 1.5c-2.6 0-4.5 2-4.5 4.5 0 3.1 4.5 8 4.5 8s4.5-4.9 4.5-8c0-2.5-1.9-4.5-4.5-4.5z"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
                <circle cx="8" cy="6" r="1.6" fill="currentColor" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="chat-reroll-dice"
            onClick={onReroll}
            aria-label="reroll name"
            title="reroll name"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke="currentColor" stroke-width="1.4" />
              <circle cx="5" cy="5" r="1.1" fill="currentColor" />
              <circle cx="11" cy="5" r="1.1" fill="currentColor" />
              <circle cx="8" cy="8" r="1.1" fill="currentColor" />
              <circle cx="5" cy="11" r="1.1" fill="currentColor" />
              <circle cx="11" cy="11" r="1.1" fill="currentColor" />
            </svg>
          </button>
        </span>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {messages.map((m) => (
          <div className="chat-msg" key={m.id}>
            <span className="chat-msg-dot" style={{ background: m.color }} />
            <WikiArticleLink className="chat-msg-who" title={m.name} />{" "}
            <span className="chat-msg-body">{m.text}</span>
          </div>
        ))}
      </div>
      {sendError ? <div className="chat-error">{sendError}</div> : null}
      <div className={`chat-input-row ${sendError ? "has-error" : ""}`}>
        <span className="you-dot" style={{ background: myColor }} />
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={inputFocused ? "say something…" : "press / to chat"}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          rows={1}
        />
        {showCounter ? (
          <span className="chat-counter">{MAX_MESSAGE_LENGTH - value.length}</span>
        ) : null}
      </div>
    </div>
  );
}
