import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { api } from '../lib/api.js';

function timeLabel(value) {
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function Sidebar({ onOpenSettings, isDark, onToggleTheme }) {
  const { user, logout } = useAuth();
  const { conversations, selectedPeerId, openPeer, refreshConversations } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    refreshConversations();
    const timer = setInterval(refreshConversations, 30_000);
    return () => clearInterval(timer);
  }, [refreshConversations]);

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchUsers(trimmed);
        if (active) setResults(data.users);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const rows = query ? results : conversations;

  return (
    <aside className="sidebar" aria-label="Conversations">
      <header className="sidebar-masthead">
        <h1 className="wordmark">Cipher</h1>
        <span className="chip chip-e2ee">
          <Icon name="lock" size={13} />
          E2EE Active
        </span>
      </header>

      <div className="sidebar-me">
        <Avatar name={user?.username} src={user?.avatar} size={36} />
        <div className="me-meta">
          <strong className="me-name">{user?.username}</strong>
          <span className="me-fp">your key stays on this device</span>
        </div>
        <div className="me-actions">
          <button
            type="button"
            className="icon-btn"
            title={isDark ? 'Light theme' : 'Dark theme'}
            aria-label={isDark ? 'Light theme' : 'Dark theme'}
            onClick={onToggleTheme}
          >
            <Icon name={isDark ? 'sun' : 'moon'} size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Settings"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <Icon name="settings" size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Sign out"
            aria-label="Log out"
            onClick={logout}
          >
            <Icon name="logoff" size={17} />
          </button>
        </div>
      </div>

      <label className="searchbox">
        <Icon name="search" size={16} />
        <input
          name="search-users"
          type="search"
          placeholder="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search users"
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </label>

      <nav className="conv-list">
        {!query && <h2 className="list-heading">Conversations</h2>}
        {query && rows.length === 0 && !searching && (
          <p className="list-empty">No users match “{query}”.</p>
        )}
        {rows.map((row) => {
          const isResult = query.length > 0;
          const id = isResult ? row.id : row.peerId;
          const active = selectedPeerId === id;
          const name = isResult ? row.username : row.peerName;
          const avatar = isResult ? row.avatar : row.peerAvatar;
          return (
            <button
              type="button"
              key={id}
              className={`conv-row ${active ? 'is-active' : ''}`}
              aria-current={active || undefined}
              onClick={() => openPeer(id)}
            >
              <Avatar name={name} src={avatar} size={36} />
              <span className="conv-meta">
                <span className="conv-top">
                  <strong className="conv-name">{name}</strong>
                  {!isResult && row.lastAt && (
                    <time className="conv-time">{timeLabel(row.lastAt)}</time>
                  )}
                </span>
                {!isResult && (
                  <span className="conv-preview">
                    {row.lastMine ? 'You: ' : ''}
                    Sealed message
                  </span>
                )}
              </span>
              {!isResult && row.unread > 0 && (
                <span className="badge pill" aria-label={`${row.unread} unread`}>
                  {row.unread}
                </span>
              )}
            </button>
          );
        })}
        {!query && conversations.length === 0 && (
          <p className="list-empty">No conversations yet. Search for a username to start one.</p>
        )}
      </nav>
    </aside>
  );
}