# Cipher

A meeting-ground chat app with end-to-end encryption in the browser. Messages are sealed
twice — once for the sender, once for the recipient — with AES-256-GCM content keys wrapped
by RSA-OAEP. The server stores opaque ciphertext blobs and never sees a plaintext message.

## Running

Requirements: Node 20+, MongoDB 6+ (or 7.x, tested against 7.0.14).

```sh
# 1. Start MongoDB (any local instance):
mongod --dbpath ./data --fork --logpath ./data/mongod.log --port 27017
mkdir -p data

# 2. Backend (defaults to mongodb://127.0.0.1:27017/cipher)
cd backend && cp .env.example .env && npm install && npm run dev

# 3. Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

## Tests

```sh
cd backend && npm test          # unit + API tests (uses a local MongoDB test database)
cd backend && npm run smoke     # end-to-end smoke against a running server
cd backend && npm run browser:test  # full browser E2E (Chromium)
```

## Trust model

- Content keys are generated per message and never transmitted; AES-GCM keys live only
  inside the browser's WebCrypto context.
- The server holds no private keys and stores ciphertext only (`forSender`, `forRecipient`).
- Each account holds an RSA-OAEP keypair in IndexedDB under `keyPair:<userId>`.
  A different browser/device is a different identity and shows
  "encrypted for a different device" instead of plaintext.
- No forward secrecy: message keys are static. Directionality, readability and honesty
  about crypto state are the point — not rolling session keys.