import process from 'node:process';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Server } from 'socket.io';

process.env.MONGODB_URL = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/cipher_smoke';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../app.js');
const { default: initSockets } = await import('../sockets/index.js');
import config from '../config/index.js';

const base = (port, path) => `http://127.0.0.1:${port}${path}`;
const api = (port, path) => base(port, `/api${path}`);

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) throw new Error(`FAIL ${name} ${detail}`);
}

async function main() {
  await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 4000 });
  await mongoose.connection.dropDatabase();

  const app = createApp({ isTest: true });
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  app.set('io', io);
  initSockets(io);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const health = await fetch(base(port, '/health'));
    check('health', health.ok && (await health.json()).ok === true);

    const signup = async (u) => {
      const res = await fetch(api(port, '/auth/signup'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'Password-1234', email: `${u}@example.com` })
      });
      if (!res.ok) throw new Error(`signup ${u} -> ${res.status}`);
      return res.json();
    };

    const alice = await signup('smokea');
    const bob = await signup('smokeb');
    check('signup returns tokens', alice.token && bob.token);

    const putKey = async (token) =>
      fetch(api(port, '/auth/keys'), {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ spki: crypto.randomBytes(294).toString('base64') })
      });
    check('alice key stored', (await putKey(alice.token)).status === 201);
    check('bob key stored', (await putKey(bob.token)).status === 201);

    const bobProfile = await fetch(api(port, `/users/${bob.user.id}`), {
      headers: { authorization: `Bearer ${alice.token}` }
    });
    const bobFingerprint = (await bobProfile.json()).user.publicKey.fingerprint;
    check('user key is revocable-fingerprinted', /^[0-9a-f]{64}$/.test(bobFingerprint));

    const sealed = () => ({ ct: crypto.randomBytes(16).toString('base64'), iv: crypto.randomBytes(12).toString('base64'), alg: 'AES-GCM' });
    const sent = await fetch(api(port, `/messages/${bob.user.id}`), {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        forSender: sealed(),
        forRecipient: sealed(),
        keyId: bobFingerprint
      })
    });
    check('encrypted send', sent.status === 201);
    const messageId = (await sent.json()).message.id;

    const thread = await fetch(api(port, `/messages/${bob.user.id}`), {
      headers: { authorization: `Bearer ${alice.token}` }
    });
    const threadJson = await thread.json();
    check('thread round-trips ciphertext', threadJson.messages.length === 1 && !threadJson.messages[0].payload.forSender.ct.includes('tiny'));

    const read = await fetch(api(port, `/messages/${messageId}/read`), {
      method: 'POST',
      headers: { authorization: `Bearer ${bob.token}` }
    });
    check('read receipt', (await read.json()).read === true);

    const convos = await fetch(api(port, '/conversations'), {
      headers: { authorization: `Bearer ${bob.token}` }
    });
    const convosJson = await convos.json();
    const threadRow = convosJson.conversations.find((c) => c.peerId === alice.user.id);
    check('conversation has unread 0 after read', threadRow && threadRow.unread === 0);

    console.log('SMOKE PASS —', checks.length, 'checks');
  } finally {
    await new Promise((r) => io.close(r));
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});