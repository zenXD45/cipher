import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  connectTestDb,
  closeTestDb,
  makeApp,
  signup,
  attachKey,
  fakeSpki,
  spkiFingerprint
} from './helpers.js';
import { User } from '../models/User.js';

let app;

describe('auth', () => {
  before(async () => {
    await connectTestDb();
    app = makeApp();
  });
  after(closeTestDb);

  test('signup creates a user and returns a token', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'alice',
      password: 'Password-1234',
      email: 'alice@example.com'
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.token.length > 20);
    assert.equal(res.body.user.username, 'alice');
    assert.equal(res.body.user.avatar, '');
    assert.equal(res.body.user.hasKey, false);
    assert.equal(res.body.user.passwordHash, undefined);
  });

  test('signup rejects a too-short username', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'a',
      password: 'Password-1234'
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Usernames/);
  });

  test('signup normalizes an uppercase username to lowercase and accepts it', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'INVALID_UP',
      password: 'Password-1234'
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.username, 'invalid_up');
  });

  test('signup rejects a short password', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'shortpass',
      password: 'short'
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /8/);
  });

  test('signup rejects a duplicate username', async () => {
    await request(app).post('/api/auth/signup').send({ username: 'dupe', password: 'Password-1234' });
    const res = await request(app).post('/api/auth/signup').send({ username: 'dupe', password: 'Password-1234' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /taken/);
  });

  test('signup rejects a duplicate email', async () => {
    await request(app).post('/api/auth/signup').send({ username: 'emailone', email: 'dup@example.com', password: 'Password-1234' });
    const res = await request(app).post('/api/auth/signup').send({ username: 'emailtwo', email: 'dup@example.com', password: 'Password-1234' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /email/);
  });

  test('signup strips any non-http avatar', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'avatarx',
      password: 'Password-1234',
      avatar: 'javascript:alert(1)'
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.avatar, '');
  });

  test('signup keeps an https avatar', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'avatarok',
      password: 'Password-1234',
      avatar: 'https://example.com/me.png'
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.avatar, 'https://example.com/me.png');
  });

  test('login succeeds and reveals the same user', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'Password-1234' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'alice');
  });

  test('login fails on wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'Wrong-Pass' });
    assert.equal(res.status, 401);
  });

  test('login fails for unknown user', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'Password-1234' });
    assert.equal(res.status, 401);
  });

  test('/me returns the authenticated user', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'Password-1234' });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'alice');
  });

  test('/me rejects a missing token', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  test('/me rejects a forged token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.real.token');
    assert.equal(res.status, 401);
  });

  test('PUT /auth/keys stores a key and fingerprints it', async () => {
    const reg = await signup(app, 'keyuser');
    const spki = fakeSpki();
    const res = await request(app)
      .put('/api/auth/keys')
      .set('Authorization', `Bearer ${reg.token}`)
      .send({ spki });
    assert.equal(res.status, 201);
    assert.equal(res.body.fingerprint, spkiFingerprint(spki));
    const user = await User.findOne({ username: 'keyuser' });
    assert.equal(user.activeKey.fingerprint, spkiFingerprint(spki));
  });

  test('PUT /auth/keys rejects a non-base64 payload', async () => {
    const reg = await signup(app, 'keybad');
    const res = await request(app)
      .put('/api/auth/keys')
      .set('Authorization', `Bearer ${reg.token}`)
      .send({ spki: 'not base64!!!' });
    assert.equal(res.status, 400);
  });

  test('google login is 501 when not configured', async () => {
    const res = await request(app).post('/api/auth/google').send({ credential: 'x.y.z' });
    assert.equal(res.status, 501);
  });
});