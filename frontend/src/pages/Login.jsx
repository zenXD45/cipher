import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login({ onSwitch }) {
  const { login, authError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await login({ username, password });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden="true"><Icon name="lock" size={22} /></span>
          <h1 id="auth-title">Cipher</h1>
        </div>
        <p className="auth-lede">
          End-to-end encrypted chat. Messages are sealed twice — once for you, once for the
          recipient. The server never sees a word.
        </p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <p id="auth-error" className="auth-error" role="alert" aria-live="polite">
            {error || authError}
          </p>
          <label className="field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          No account yet?{' '}
          <button type="button" className="link-btn" onClick={onSwitch}>
            Sign up
          </button>
        </p>

        <p className="auth-note">
          Your decryption key lives in this browser under your account. No server can recover it —
          <strong> hold your decryption key</strong>.
        </p>
      </section>
    </main>
  );
}