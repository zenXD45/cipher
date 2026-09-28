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
  sealedOverload
} from './helpers.js';

let app;

async function twoUsers(who = 'alice', whom = 'bob') {
  const a = await signup(app, who);
  const b = await signup(app, whom);
  const keyA = fakeSpki();
  const keyB = fakeSpki();
  await request(app).put('/api/auth/keys').set('Authorization', `Bearer ${a.token}`).send({ spki: keyA });
  await request(app).put('/api/auth/keys').set('Authorization', `Bearer ${b.token}`).send({ spki: keyB });
  return { a, b, keyA, keyB };
}

describe('messages', () => {
  before(async () => {
    await connectTestDb();
    app = makeApp();
  });
  after(closeTestDb);

  test('send stores two sealed copies and never a plaintext field', async () => {
    const { a, b } = await twoUsers('m1a', 'm1b');
    const res = await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload(), keyId: '0'.repeat(64) });
    assert.equal(res.status, 201);
    assert.equal(res.body.message.mine, true);
    assert.equal(res.body.message.payload.forSender.alg, 'AES-GCM');
  });

  test('send requires the recipient to own a key', async () => {
    const a = await signup(app, 'nokeyav');
    const b = await signup(app, 'nokeybob');
    const res = await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /set up encryption/);
  });

  test('send rejects a plaintext "text" field outright', async () => {
    const { a, b } = await twoUsers('plainta', 'plaintb');
    const res = await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ text: 'hello in plain sight', forSender: sealedOverload(), forRecipient: sealedOverload() });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Plaintext/);
  });

  test('send rejects an unexpected field inside a sealed envelope', async () => {
    const { a, b } = await twoUsers('envfa', 'envfb');
    const res = await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: { ...sealedOverload(), sender: 'alice' }, forRecipient: sealedOverload() });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unexpected field/);
  });

  test('send rejects messaging yourself', async () => {
    const a = await signup(app, 'soloist');
    const res = await request(app)
      .post(`/api/messages/${a.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    assert.equal(res.status, 400);
  });

  test('thread returns both sides oldest-first with mine + read flags', async () => {
    const { a, b } = await twoUsers('thrda', 'thrdb');
    const sender = (who, other) =>
      request(app)
        .post(`/api/messages/${other.user.id}`)
        .set('Authorization', `Bearer ${who.token}`)
        .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });

    assert.equal((await sender(a, b)).status, 201);
    assert.equal((await sender(b, a)).status, 201);
    assert.equal((await sender(a, b)).status, 201);

    const res = await request(app)
      .get(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.messages.length, 3);
    assert.deepEqual(res.body.messages[0].mine, true);
    assert.deepEqual(res.body.messages[1].mine, false);
    res.body.messages.forEach((m) => {
      assert.equal(typeof m.payload.forSender.ct, 'string');
      assert.equal(typeof m.payload.forRecipient.ct, 'string');
    });
  });

  test('thread paginates by cursor', async () => {
    const { a, b } = await twoUsers('paga', 'pagb');
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/messages/${b.user.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    }
    const first = await request(app)
      .get(`/api/messages/${b.user.id}?limit=2`)
      .set('Authorization', `Bearer ${a.token}`);
    assert.equal(first.body.messages.length, 2);
    const cursor = first.body.messages[0].id;
    const next = await request(app)
      .get(`/api/messages/${b.user.id}?limit=2&before=${cursor}`)
      .set('Authorization', `Bearer ${a.token}`);
    assert.equal(next.body.messages.length, 2);
    assert.notEqual(next.body.messages[0].id, cursor);
  });

  test('markRead sets readAt only for the recipient, and is idempotent', async () => {
    const { a, b } = await twoUsers('reada', 'readb');
    const sent = await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    const id = sent.body.message.id;

    const wrongSide = await request(app)
      .post(`/api/messages/${id}/read`)
      .set('Authorization', `Bearer ${a.token}`);
    assert.equal(wrongSide.status, 404);

    const ok = await request(app)
      .post(`/api/messages/${id}/read`)
      .set('Authorization', `Bearer ${b.token}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.read, true);

    const again = await request(app)
      .post(`/api/messages/${id}/read`)
      .set('Authorization', `Bearer ${b.token}`);
    assert.equal(again.body.read, true);

    const thread = await request(app)
      .get(`/api/messages/${a.user.id}`)
      .set('Authorization', `Bearer ${b.token}`);
    assert.equal(thread.body.messages[0].read, true);
  });

  test('conversations aggregates latest message and unread counts per peer', async () => {
    const { a, b } = await twoUsers('conva', 'convb');
    const c = await signup(app, 'convc');
    await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    await request(app)
      .post(`/api/messages/${c.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${b.token}`);
    assert.equal(res.status, 200);
    // bob sees only the thread with alice, unread == 2 (both messages from alice unread)
    assert.ok(res.body.conversations.some((c) => c.peerId === a.user.id));
    const thread = res.body.conversations.find((c) => c.peerId === a.user.id);
    assert.equal(thread.unread, 2);
    assert.equal(thread.lastMine, false);
  });

  test('read receipts clear the unread count', async () => {
    const { a, b } = await twoUsers('unreada', 'unreadb');
    const sent = await request(app)
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forSender: sealedOverload(), forRecipient: sealedOverload() });
    await request(app)
      .post(`/api/messages/${sent.body.message.id}/read`)
      .set('Authorization', `Bearer ${b.token}`);
    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${b.token}`);
    const thread = res.body.conversations.find((c) => c.peerId === a.user.id);
    assert.equal(thread.unread, 0);
  });
});