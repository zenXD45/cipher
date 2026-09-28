import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { connectTestDb, closeTestDb, makeApp, signup } from './helpers.js';

describe('security & hardening', () => {
  before(async () => {
    await connectTestDb();
  });
  after(closeTestDb);

  test('helmet security headers are present', async () => {
    const app = makeApp();
    const res = await request(app).get('/health');
    assert.ok(res.headers['content-security-policy']);
    assert.ok(res.headers['x-content-type-options']);
    assert.ok(res.headers['x-frame-options']);
    assert.ok(res.headers['strict-transport-security']);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('CORS allows only the configured frontend origin', async () => {
    const app = makeApp();
    const good = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    assert.equal(good.headers['access-control-allow-origin'], 'http://localhost:5173');
    const evil = await request(app).get('/health').set('Origin', 'https://evil.example');
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
  });

  test('auth endpoints rate-limit to 6 attempts in tightening mode', async () => {
    const app = makeApp({ testRatelimit: true });
    let status = 200;
    for (let i = 0; i < 7; i++) {
      status = (await request(app).post('/api/auth/login').send({ username: 'x', password: 'y' })).status;
    }
    assert.equal(status, 429);
  });

  test('unknown api route returns a JSON 404', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error, 'string');
  });

  test('oversized body is rejected with 413', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Content-Type', 'application/json')
      .send({ username: 'x'.repeat(200_000) });
    assert.equal(res.status, 413);
  });

  test('jwt tokens embed the subject and no extra identity claims', async () => {
    const app = makeApp({ isTest: false });
    // production-like app requires secret via config already set (dev fallback)
    const reg = await request(app).post('/api/auth/signup').send({
      username: 'claimfree',
      password: 'Password-1234'
    });
    assert.equal(reg.status, 201);
    const header = reg.body.token.split('.')[0];
    const payload = JSON.parse(Buffer.from(header, 'base64url'));
    const claims = JSON.parse(Buffer.from(reg.body.token.split('.')[1], 'base64url'));
    assert.equal(payload.alg, 'HS256');
    assert.equal(typeof claims.sub, 'string');
    assert.equal(claims.email, undefined);
    assert.equal(claims.username, undefined);
  });
});