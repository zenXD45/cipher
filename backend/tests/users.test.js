import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { connectTestDb, closeTestDb, makeApp, signup, attachKey, fakeSpki } from './helpers.js';

let app;

describe('users', () => {
  before(async () => {
    await connectTestDb();
    app = makeApp();
  });
  after(closeTestDb);

  test('search returns other users, never the caller', async () => {
    await signup(app, 'finderx');
    await signup(app, 'findery');
    const me = await signup(app, 'findme');
    const res = await request(app)
      .get('/api/users?q=find')
      .set('Authorization', `Bearer ${me.token}`);
    assert.equal(res.status, 200);
    const names = res.body.users.map((u) => u.username);
    assert.ok(names.includes('finderx'));
    assert.ok(names.includes('findery'));
    assert.ok(!names.includes('findme'));
  });

  test('search never includes the caller', async () => {
    const me = await signup(app, 'solo');
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${me.token}`);
    assert.ok(!res.body.users.some((u) => u.username === 'solo'));
  });

  test('getUser exposes the public key spki + fingerprint when set', async () => {
    const owner = await signup(app, 'pubkey');
    const spki = fakeSpki();
    await request(app).put('/api/auth/keys').set('Authorization', `Bearer ${owner.token}`).send({ spki });
    const viewer = await signup(app, 'viewer');
    const res = await request(app)
      .get(`/api/users/${owner.user.id}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.publicKey.spki, spki);
    assert.equal(res.body.user.hasKey, true);
  });

  test('getUser 404s for a missing id', async () => {
    const me = await signup(app, 'missingid');
    const res = await request(app)
      .get('/api/users/000000000000000000000000')
      .set('Authorization', `Bearer ${me.token}`);
    assert.equal(res.status, 404);
  });

  test('account patch updates username and sanitizes avatar', async () => {
    const me = await signup(app, 'rename');
    const res = await request(app)
      .patch('/api/account')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ username: 'renamed', avatar: 'javascript:x' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'renamed');
    assert.equal(res.body.user.avatar, '');
  });

  test('account patch keeps a valid https avatar', async () => {
    const me = await signup(app, 'avatar2');
    const res = await request(app)
      .patch('/api/account')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ avatar: 'https://example.org/a.png' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.avatar, 'https://example.org/a.png');
  });

  test('account patch rejects a taken username', async () => {
    await signup(app, 'takenone');
    const me = await signup(app, 'taker');
    const res = await request(app)
      .patch('/api/account')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ username: 'takenone' });
    assert.equal(res.status, 409);
  });
});