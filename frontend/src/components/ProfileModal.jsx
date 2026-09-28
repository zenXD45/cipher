import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useAuth, useOwnFingerprint } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import * as keyStore from '../lib/keyStore.js';
import { generateKeyPair } from '../lib/crypto.js';

export default function ProfileModal({ onClose }) {
  const { user, updateSelf, logout } = useAuth();
  const ownFingerprint = useOwnFingerprint();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const firstFieldRef = useRef(null);
  const [username, setUsername] = useState(user?.username || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    setUsername(user?.username || '');
    setAvatar(user?.avatar || '');
  }, [user]);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = useCallback(
    async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const data = await api.patchAccount({ username, avatar });
        updateSelf(data.user);
        setNotice('Saved. Changes apply across devices on the next sync.');
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, username, avatar, updateSelf]
  );

  async function rotateKey() {
    if (rotating || !user) return;
    setRotating(true);
    setError('');
    setNotice('');
    try {
      const keys = await generateKeyPair();
      await keyStore.setUserKey(user.id, keys);
      await api.storeKey(keys.publicKey);
      setNotice('Key rotated. New messages use the new key; older ones stay sealed.');
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setRotating(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <section className="modal" aria-labelledby="profile-title">
        <header className="modal-header">
          <h2 id="profile-title">Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => onCloseRef.current()}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <form className="modal-body" onSubmit={save}>
          <p id="profile-error" className="auth-error" role="alert" aria-live="polite">
            {error}
          </p>
          {notice ? (
            <p className="modal-notice" role="status">
              {notice}
            </p>
          ) : null}

          <label className="field">
            <span>Username</span>
            <input
              ref={firstFieldRef}
              name="username"
              autoCapitalize="none"
              spellCheck="false"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Avatar URL</span>
            <input
              name="avatar"
              type="url"
              placeholder="https://…  (optional)"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
            />
          </label>

          <div className="key-card">
            <div className="key-card-head">
              <span className="chip chip-e2ee">
                <Icon name="lock" size={12} />
                Active key
              </span>
              <button type="button" className="link-btn danger-link" onClick={rotateKey} disabled={rotating}>
                {rotating ? 'Rotating…' : 'Rotate key'}
              </button>
            </div>
            <p className="key-fingerprint" aria-label="Your key fingerprint">
              {ownFingerprint ? ownFingerprint.match(/.{1,8}/g).join(' ') : '…'}
            </p>
            <p className="key-note">
              This fingerprint identifies the public half of your key. Anyone messaging you seals
              against it; anyone reading your messages needs the private half, which never leaves
              this device.
            </p>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => onCloseRef.current()}>
              Close
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        <footer className="modal-footer">
          <button type="button" className="link-btn danger-link" onClick={logout}>
            Log out
          </button>
        </footer>
      </section>
    </div>
  );
}