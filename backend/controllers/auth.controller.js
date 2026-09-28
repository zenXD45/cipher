import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { signToken } from '../utils/token.js';
import config from '../config/index.js';

const BCRYPT_ROUNDS = 10;

const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

function bad(message) {
  return { status: 400, message };
}

export function sanitizeAvatar(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return '';
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : '';
}

function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email || null,
    avatar: user.avatar || '',
    hasKey: Boolean(user.activeKey),
    createdAt: user.createdAt
  };
}

export async function signup(req, res) {
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 8–72 characters' });
  }

  if (await User.exists({ username })) {
    return res.status(409).json({ error: 'That username is taken' });
  }
  if (email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ error: 'That email is already in use' });
    }
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({
    username,
    email: email || undefined,
    passwordHash,
    avatar: sanitizeAvatar(req.body.avatar)
  });

  const token = signToken(user._id);
  res.status(201).json({ token, user: publicUser(user) });
}

export function validateUsername(username) {
  if (!USERNAME_RE.test(username)) {
    return 'Usernames are 3–24 characters: letters, numbers, _ or -';
  }
  return null;
}

export async function login(req, res) {
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password) return bad('Username and password are required');

  const user = await User.findOne({ username });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  const token = signToken(user._id);
  res.json({ token, user: publicUser(user) });
}

export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function storeKey(req, res) {
  const spki = req.body?.spki;
  if (typeof spki !== 'string' || !/^[\w+/]+={0,2}$/.test(spki)) {
    return res.status(400).json({ error: 'A public key in base64 DER (SPKI) is required' });
  }
  let der;
  try {
    der = Buffer.from(spki, 'base64');
  } catch {
    return res.status(400).json({ error: 'Public key is not valid base64' });
  }
  if (der.length === 0 || der.length > 2048) {
    return res.status(400).json({ error: 'Public key has an invalid length' });
  }
  const fingerprint = crypto.createHash('sha256').update(der).digest('hex');
  if (fingerprint.length !== 64) return res.status(500).json({ error: 'Could not fingerprint key' });

  await User.updateOne(
    { _id: req.userId },
    { $set: { activeKey: { spki, fingerprint, updatedAt: new Date() } } }
  );
  res.status(201).json({ fingerprint });
}

export async function googleLogin(req, res) {
  if (!config.googleClientId || !config.googleClientSecret) {
    return res.status(501).json({ error: 'Google sign-in is not configured on this server' });
  }
  const token = req.body?.credential || req.body?.idToken;
  if (!token) return bad('Google credential is required');

  let profile;
  try {
    const response = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token })
    });
    if (!response.ok) return res.status(401).json({ error: 'Google rejected the credential' });
    profile = await response.json();
  } catch {
    return res.status(502).json({ error: 'Could not reach Google' });
  }

  if (profile.aud !== config.googleClientId) {
    return res.status(401).json({ error: 'Credential is for a different application' });
  }
  const email = String(profile.email || '').toLowerCase();
  const googleId = String(profile.sub);

  let user = await User.findOne({ googleId });
  if (!user && email) user = await User.findOne({ email });
  if (!user) {
    const username = email
      ? email.split('@')[0].replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'user'
      : `user${googleId.slice(0, 8)}`;
    const base = username;
    let candidate = base;
    let n = 1;
    while (await User.exists({ username: candidate })) candidate = `${base}${n++}`;
    user = await User.create({ username: candidate, email: email || undefined, googleId });
    await User.updateOne(
      { _id: user._id },
      { $set: { googleId, email: email || undefined } }
    );
  } else if (!user.googleId) {
    await User.updateOne({ _id: user._id }, { $set: { googleId } });
  }

  const jwt = signToken(user._id);
  res.json({ token: jwt, user: publicUser(user) });
}