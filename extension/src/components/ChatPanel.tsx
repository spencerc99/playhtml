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
  sendError: string | null;
  onSend: (text: string) => void;
  onClose: () => void;
  onReroll: () => void;
  onClearError: () => void;
}

const MAX_MESSAGE_LENGTH = 400;
const SOFT_COUNTER_AT = 380;

export function ChatPanel({
  messages,
  handle,
  myColor,
  articleTitle,
  sendError,
  onSend,
  onClose,
  onReroll,
  onClearError,
}: ChatPanelProps) {
  const [value, setValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        <button type="button" className="chat-reroll" onClick={onReroll}>
          reroll
        </button>
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
