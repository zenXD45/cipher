import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../app.js';

export const TEST_DB_URL =
  process.env.TEST_MONGODB_URL || 'mongodb://127.0.0.1:27017/cipher_test';

export async function connectTestDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(TEST_DB_URL, { serverSelectionTimeoutMS: 4000 });
  await mongoose.connection.dropDatabase();
}

export async function closeTestDb() {
  await mongoose.disconnect();
}

export function makeApp(overrides = {}) {
  return createApp({ isTest: true, ...overrides });
}

export function randBytes(n) {
  return crypto.randomBytes(n);
}

export function sealedOverload() {
  return { ct: randBytes(16).toString('base64'), iv: randBytes(12).toString('base64'), alg: 'AES-GCM' };
}

export function fakeSpki() {
  return randBytes(294).toString('base64');
}

export function spkiFingerprint(spki) {
  return crypto.createHash('sha256').update(Buffer.from(spki, 'base64')).digest('hex');
}

export async function signup(app, username, password = 'Password-1234') {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ username, password, email: `${username}@example.com` });
  if (res.status !== 201) throw new Error(`signup ${username} failed: ${res.status} ${res.body?.error}`);
  return res.body;
}

export async function login(app, username, password = 'Password-1234') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status}`);
  return res.body;
}

export async function attachKey(app, token, spki = fakeSpki()) {
  const res = await request(app)
    .put('/api/auth/keys')
    .set('Authorization', `Bearer ${token}`)
    .send({ spki });
  if (res.status !== 201) throw new Error(`attach key failed: ${res.status} ${res.body?.error}`);
  return res.body;
}