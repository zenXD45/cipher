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

## Deploying

Split hosting: API on **Render**, SPA on **Vercel**, database on
**MongoDB Atlas (M0)**.

1. **Atlas** — create an M0 cluster, a DB user, and Network Access
   `0.0.0.0/0`. Copy the SRV string:
   `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/cipher?retryWrites=true&w=majority`
2. **Vercel** — import this repo with **Root Directory: `frontend`**
   (build settings come from `frontend/vercel.json`). Add the env var
   `VITE_API_URL=https://<api>.onrender.com` (no trailing slash) and
   deploy. It is baked in at build time — changing it requires a
   redeploy. Empty means same-origin and **breaks** on Vercel.
3. **Render** — New → Blueprint → this repo (`render.yaml` at the root).
   Set `MONGODB_URL`; `JWT_SECRET` is generated. Health check: `/health`.
4. **Wire CORS** — set `FRONTEND_URL` on Render to the exact Vercel
   origin and Restart. It is the allowlist for HTTP and WebSocket
   origins; only that one origin is accepted.

Notes:

- Render free instances sleep after ~15 min idle; the first request
  wakes them (30–50 s). Socket.IO reconnects on its own.
- Vercel preview URLs are not allowlisted — only the production origin.
- Single-origin alternative: `cd frontend && npm run build`, deploy only
  Render, and the backend serves `frontend/dist` (no CORS, no
  `VITE_API_URL`).

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