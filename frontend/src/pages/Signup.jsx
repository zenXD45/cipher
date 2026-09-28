import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Signup({ onSwitch }) {
  const { signup, authError } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await signup({ username, password, email, avatar });
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
          Signed, sealed, delivered — your key is generated on this device the moment your account
          exists.
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
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <small className="field-hint">8 to 72 characters</small>
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
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Sign up'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{' '}
          <button type="button" className="link-btn" onClick={onSwitch}>
            Log in
          </button>
        </p>

        <p className="auth-note">
          Your key stays in this browser under your account. Nothing recoverable is sent to the
          server.
        </p>
      </section>
    </main>
  );
}