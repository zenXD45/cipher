import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, tokenPresent } from '../lib/api.js';
import * as keyStore from '../lib/keyStore.js';
import { fingerprint, generateKeyPair } from '../lib/crypto.js';

const AuthContext = createContext(null);

async function ensureOwnKey(userId) {
  let keys = await keyStore.getUserKey(userId);
  if (keys && keys.privateKey && keys.publicKey) return keys;
  keys = await generateKeyPair();
  await keyStore.setUserKey(userId, keys);
  return keys;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [ownKeys, setOwnKeys] = useState(null);
  const [authError, setAuthError] = useState(null);

  const bootstrap = useCallback(async (storedUser) => {
    const keys = await ensureOwnKey(storedUser.id);
    setOwnKeys(keys);
    try {
      await api.storeKey(keys.publicKey);
    } catch {
      /* fingerprint endpoint unavailable — surface below */
    }
    setUser(storedUser);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!tokenPresent()) {
        setReady(true);
        return;
      }
      try {
        const { user: storedUser } = await api.me();
        if (cancelled) return;
        await bootstrap(storedUser);
      } catch {
        setToken(null);
      }
      if (!cancelled) setReady(true);
    }
    restore();
    const onUnauth = () => {
      setToken(null);
      setUser(null);
      setReady(true);
    };
    window.addEventListener('cipher:unauthorized', onUnauth);
    return () => {
      cancelled = true;
      window.removeEventListener('cipher:unauthorized', onUnauth);
    };
  }, [bootstrap]);

  const signup = useCallback(
    async (fields) => {
      setAuthError(null);
      const data = await api.signup(fields);
      setToken(data.token);
      await bootstrap(data.user);
      setReady(true);
    },
    [bootstrap]
  );

  const login = useCallback(
    async (fields) => {
      setAuthError(null);
      const data = await api.login(fields);
      setToken(data.token);
      await bootstrap(data.user);
      setReady(true);
    },
    [bootstrap]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setOwnKeys(null);
  }, []);

  const updateSelf = useCallback((patch) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  const value = useMemo(
    () => ({ user, ready, ownKeys, authError, signup, login, logout, updateSelf }),
    [user, ready, ownKeys, authError, signup, login, logout, updateSelf]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useOwnFingerprint() {
  const { ownKeys } = useAuth();
  const [fp, setFp] = useState('');
  useEffect(() => {
    let active = true;
    if (ownKeys?.publicKey) {
      fingerprint(ownKeys.publicKey).then((f) => {
        if (active) setFp(f);
      });
    }
    return () => {
      active = false;
    };
  }, [ownKeys]);
  return fp;
}