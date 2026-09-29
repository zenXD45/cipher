# Cipher — product truth

Cipher is a quiet, end-to-end encrypted chat. Messages are sealed in the
browser and the server only ever stores ciphertext. This document states
exactly what that buys you — and what it does not.

## The short version

- The server **cannot read your messages.** Message bodies exist as
  AES-256-GCM ciphertext on disk; the content keys are wrapped with each
  participant's RSA-OAEP public key and stored alongside.
- The server **can see metadata**: who talks to whom, when, how often, and
  roughly how large each message is. It also sees your username, email, and
  avatar URL. If that matters, it is not fixed by this design.
- The server **cannot impersonate you** for past messages, but nothing here
  prevents it from serving you a tampered frontend while you are loading the
  app. Trust comes from reviewing the code you run (it is in this repo), not
  from the server's promises.

## How a message is sealed

1. The sender generates a random 256-bit content key (AES-GCM).
2. The message body is encrypted with that content key.
3. The content key is wrapped **twice**: once with the sender's own public
   key (`forSender`) and once with the recipient's (`forRecipient`).
4. Both wrapped copies, the IV, and the algorithm name are uploaded as the
   message payload. The plaintext never leaves the browser — the browser
   test suite asserts this over real network traffic.

Each device keeps its own RSA-2048 key pair in IndexedDB under
`keyPair:<userId>`. The public half is uploaded to the server so others can
seal messages to you; the private half never leaves the device.

## Honest limitations

- **No forward secrecy.** Keys are long-lived per account/device. Someone
  who steals your private key *and* obtains stored ciphertext can read
  everything sealed to that key. Rotating your key (`Settings → Rotate key`)
  stops future messages but does not retroactively protect old ones.
- **One device, one key.** There is no multi-device sync. A second device
  generates its own key pair; older messages remain sealed to the first
  device's key and show as *"encrypted for a different device."* This is
  deliberate fail-closed behavior, not a bug.
- **No key verification.** Fingerprints are shown (Settings → your key
  fingerprint) but there is no out-of-band verification flow. The first key
  the server hands you is trusted (TOFU).
- **No deletion guarantees.** Deleting messages client-side does not remove
  them from the server's database; there is no retention policy beyond what
  you control by self-hosting.
- **Ciphertext availability ≠ confidentiality.** The server can withhold or
  corrupt messages (fail-closed: they render as locked), but it cannot read
  them.

## What is deliberately absent

- No third-party critical path: no CDNs, no analytics, no fonts from
  external hosts, no crash reporters. The only network endpoints the app
  talks to are the API/socket origin it is served from, plus user-supplied
  avatar URLs (images only, `https:` only).
- No server-side rendering of message content. The API rejects payloads
  that include a plaintext `text` field.
- No avatars generated server-side. Avatar URLs are sanitized (only
  `http(s)` survives) and rendered as images in the browser; empty falls
  back to a monogram.

## Roles and states you will see

| State | Meaning |
| --- | --- |
| `E2EE Active` | Keys present for the current account in this browser. |
| `hold your decryption key` | Signup note: your key lives only here. |
| `encrypted for a different device` | Key missing or rotated; copy cannot be opened here. |
| `Decrypted in browser` | Message body opened successfully with the local private key. |
| `✓ sent` / `✓ read` | Delivery/read receipt — metadata only, not content. |
| `cipher dossier` | Per-message inspection: copy names, algorithm, key id, byte sizes. |

## Operational truth (self-hosting)

- Node.js ≥ 20 and MongoDB are the only runtime dependencies.
- Secrets: set `JWT_SECRET` in production (development falls back to a
  throwaway value). Nothing else is required to boot.
- The API serves the built frontend from `frontend/dist` in production;
  CORS is locked to `FRONTEND_URL` and WebSocket upgrades share the same
  origin.
- Rate limits: 30 requests/15 min on auth endpoints, 300/15 min general,
  413 payload cap. These protect availability, not confidentiality.
