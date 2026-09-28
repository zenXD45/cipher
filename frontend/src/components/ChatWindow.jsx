import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { MAX_MESSAGE_CHARS, openMessage } from '../lib/crypto.js';

function timeLabel(value) {
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function MessageRow({ message, privateKey }) {
  const [dossierOpen, setDossierOpen] = useState(false);
  const [body, setBody] = useState(null);

  useEffect(() => {
    let active = true;
    setBody(null);
    if (!privateKey) {
      setBody({ locked: 'no-key' });
      return undefined;
    }
    const copy = message.mine ? message.payload?.forSender : message.payload?.forRecipient;
    openMessage(copy, privateKey).then((result) => {
      if (active) setBody(result);
    });
    return () => {
      active = false;
    };
  }, [message, privateKey]);

  const preview =
    body?.text ??
    (body?.locked === 'different-device'
      ? 'encrypted for a different device'
      : body?.locked === 'no-key'
        ? 'encrypted for a different device'
        : 'decrypting…');

  return (
    <article
      className={`message-bubble ${message.mine ? 'is-mine' : 'is-theirs'}`}
      aria-label={message.mine ? 'You' : 'Them'}
    >
      <div className="bubble-text">{preview}</div>
      <footer className="bubble-meta">
        <time className="message-time" dateTime={new Date(message.createdAt).toISOString()}>
          {timeLabel(message.createdAt)}
        </time>
        {body?.text ? <span className="bubble-status">Decrypted in browser</span> : null}
        {message.mine ? (
          <span
            className={`read-receipt ${message.read ? 'is-read' : ''}`}
            data-read={message.read ? 'true' : 'false'}
          >
            {message.read ? '✓ read' : '✓ sent'}
          </span>
        ) : null}
        <button
          type="button"
          className="dossier-toggle"
          aria-expanded={dossierOpen}
          onClick={() => setDossierOpen((v) => !v)}
        >
          cipher dossier
        </button>
      </footer>
      {dossierOpen ? (
        <dl className="cipher-dossier">
          <div>
            <dt>Copy</dt>
            <dd>{message.mine ? 'forSender' : 'forRecipient'}</dd>
          </div>
          <div>
            <dt>Algorithm</dt>
            <dd>{message.payload?.forSender?.alg || 'AES-GCM'}</dd>
          </div>
          <div>
            <dt>Content key</dt>
            <dd>wrapped with RSA-OAEP · key id {message.keyId ? `${message.keyId.slice(0, 12)}…` : 'none'}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>
              {message.payload?.forSender?.ct?.length} bytes for you ·{' '}
              {message.payload?.forRecipient?.ct?.length} bytes for them
            </dd>
          </div>
        </dl>
      ) : null}
    </article>
  );
}

export default function ChatWindow() {
  const { ownKeys } = useAuth();
  const {
    peer,
    messages,
    hasOlder,
    typingPeerId,
    busy,
    sendError,
    loadError,
    closePeer,
    loadOlder,
    send,
    emitTyping
  } = useChat();

  const [text, setText] = useState('');
  const listRef = useRef(null);
  const typingTimer = useRef(null);

  const isPeerTyping = peer && typingPeerId === peer.id;

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, peer?.id]);

  async function handleSend(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const ok = await send(trimmed);
    if (ok) setText('');
  }

  function handleChange(value) {
    setText(value);
    if (!peer) return;
    emitTyping(peer.id, true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(peer.id, false), 1200);
  }

  if (!peer) {
    return (
      <section className="chat-window chat-empty" aria-label="Conversation">
        <div className="empty-mark" aria-hidden="true"><Icon name="lock" size={40} /></div>
        <h2>Choose a conversation</h2>
        <p>Messages you send are sealed twice — for you and for the person you write to.</p>
      </section>
    );
  }

  const count = text.length;

  return (
    <section className="chat-window" aria-label={`Conversation with ${peer.username}`}>
      <header className="chat-header">
        <button type="button" className="icon-btn back-btn" aria-label="Back to conversations" onClick={closePeer}>
          <Icon name="back" size={18} />
        </button>
        <Avatar name={peer.username} src={peer.avatar} size={34} />
        <div className="chat-title">
          <h2>{peer.username}</h2>
          <p className="chat-subtitle">
            {isPeerTyping ? <span className="typing-hint">typing…</span> : 'direct message'}
          </p>
        </div>
        <span className="chip chip-e2ee">
          <Icon name="lock" size={13} />
          E2EE Active
        </span>
      </header>

      <div className="chat-body">
        {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
        <div className="message-list" ref={listRef}>
          {messages.length === 0 && !busy ? (
            <p className="thread-empty">
              No messages yet. Say something — it will only ever exist encrypted.
            </p>
          ) : null}
          {hasOlder ? (
            <button type="button" className="load-older" onClick={loadOlder}>
              Load earlier messages
            </button>
          ) : null}
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} privateKey={ownKeys?.privateKey} />
          ))}
        </div>
      </div>

      <form className="composer" onSubmit={handleSend}>
        <label className="composer-field">
          <span className="hidden-label">Message</span>
          <textarea
            name="message"
            rows={1}
            value={text}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Message"
            aria-label="Message"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            onChange={(e) => handleChange(e.target.value)}
          />
          {count > 0 ? <span className="char-count">{count}/{MAX_MESSAGE_CHARS}</span> : null}
        </label>
        <button className="btn send-btn" type="submit" disabled={busy || text.length === 0} aria-label="Send message">
          {busy ? '…' : <Icon name="send" size={18} />}
        </button>
      </form>
      {sendError ? <p className="inline-error composer-error" role="alert">{sendError}</p> : null}
    </section>
  );
}