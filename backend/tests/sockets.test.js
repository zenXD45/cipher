import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { connectTestDb, closeTestDb, makeApp, signup, fakeSpki, sealedOverload } from './helpers.js';
import initSockets from '../sockets/index.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, resolve));
  return server.address().port;
}

function closeServer(server, io) {
  return new Promise((resolve) => {
    io.close(() => server.close(resolve));
  });
}

describe('sockets', () => {
  before(async () => {
    await connectTestDb();
  });
  after(closeTestDb);

  test('typing relays from one authenticated client to the peer room', async () => {
    const app = makeApp();
    app.set('io', undefined);
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' } });
    app.set('io', io);
    initSockets(io);
    const port = await listen(server);

    const alice = await signup(app, 'socka');
    const bob = await signup(app, 'sockb');

    // bob must have a key for alice to message him; give bob one
    await fetch(`http://127.0.0.1:${port}/api/auth/keys`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${bob.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ spki: fakeSpki() })
    });

    const clientA = ioc(`http://127.0.0.1:${port}`, { auth: { token: alice.token } });
    const clientB = ioc(`http://127.0.0.1:${port}`, { auth: { token: bob.token } });
    await Promise.all([
      new Promise((r) => clientA.on('connect', r)),
      new Promise((r) => clientB.on('connect', r))
    ]);

    const typingHeard = new Promise((r) => clientB.once('typing', (e) => r(e)));
    clientA.emit('typing', { to: bob.user.id, state: true });
    const event = await typingHeard;
    assert.equal(event.from, alice.user.id);
    assert.equal(event.state, true);

    clientA.close();
    clientB.close();
    await closeServer(server, io);
  });

  test('sending a message pushes a live message:new event to both rooms', async () => {
    const app = makeApp();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' } });
    app.set('io', io);
    initSockets(io);
    const port = await listen(server);

    const alice = await signup(app, 'livea');
    const bob = await signup(app, 'liveb');
    await fetch(`http://127.0.0.1:${port}/api/auth/keys`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${bob.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ spki: fakeSpki() })
    });

    const clientA = ioc(`http://127.0.0.1:${port}`, { auth: { token: alice.token } });
    const clientB = ioc(`http://127.0.0.1:${port}`, { auth: { token: bob.token } });
    await Promise.all([
      new Promise((r) => clientA.on('connect', r)),
      new Promise((r) => clientB.on('connect', r))
    ]);
    const bHeard = new Promise((r) => clientB.once('message:new', (m) => r(m)));

    const res = await fetch(`http://127.0.0.1:${port}/api/messages/${bob.user.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        forSender: sealedOverload(),
        forRecipient: sealedOverload(),
        keyId: 'a'.repeat(64)
      })
    });
    assert.equal(res.status, 201);
    const received = await Promise.race([bHeard, new Promise((r) => setTimeout(() => r(null), 3000))]);
    assert.ok(received, 'recipient should receive live message:new');
    assert.equal(received.payload.forRecipient.alg, 'AES-GCM');

    clientA.close();
    clientB.close();
    await closeServer(server, io);
  });

  test('socket handshake rejects a missing token', async () => {
    const server = http.createServer(makeApp());
    const io = new Server(server, { cors: { origin: '*' } });
    initSockets(io);
    const port = await listen(server);
    const client = ioc(`http://127.0.0.1:${port}`, { auth: {} });
    const error = await new Promise((r) => client.on('connect_error', r));
    assert.equal(error.message, 'You must be signed in');
    client.close();
    await new Promise((r) => io.close(r));
    await new Promise((r) => server.close(r));
  });
});