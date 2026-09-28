const enc = new TextEncoder();
const dec = new TextDecoder();

const RSA = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const RSA_ALG = { name: 'RSA-OAEP', hash: 'SHA-256' };
const AES_ALG = { name: 'AES-GCM', length: 256 };

export const MAX_MESSAGE_CHARS = 4000;
export const WRAPPED_BYTES = 256;

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(str) {
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(RSA, true, ['encrypt', 'decrypt']);
  const privateKey = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicKey = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { privateKey: b64(privateKey), publicKey: b64(publicKey) };
}

export async function importPublicKey(spki) {
  return crypto.subtle.importKey('spki', fromB64(spki), RSA_ALG, false, ['encrypt']);
}

export async function importPrivateKey(pkcs8) {
  return crypto.subtle.importKey('pkcs8', fromB64(pkcs8), RSA_ALG, false, ['decrypt']);
}

export async function fingerprint(spki) {
  const digest = await crypto.subtle.digest('SHA-256', fromB64(spki));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function aesEncrypt(text) {
  const contentKey = await crypto.subtle.generateKey(AES_ALG, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = await crypto.subtle.exportKey('raw', contentKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, enc.encode(text));
  return { rawKey, iv, ciphertext };
}

async function buildSealedCopy(spki, rawKey, iv, ciphertext) {
  const publicKey = await importPublicKey(spki);
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
  const joined = new Uint8Array(wrappedKey.byteLength + ciphertext.byteLength);
  joined.set(new Uint8Array(wrappedKey), 0);
  joined.set(new Uint8Array(ciphertext), wrappedKey.byteLength);
  return { ct: b64(joined), iv: b64(iv), alg: 'AES-GCM' };
}

export async function sealMessage(text, ownSpki, peerSpki) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('Nothing to send');
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('Message is too long');
  const { rawKey, iv, ciphertext } = await aesEncrypt(text);
  const forSender = await buildSealedCopy(ownSpki, rawKey, iv, ciphertext);
  const forRecipient = await buildSealedCopy(peerSpki, rawKey, iv, ciphertext);
  const keyId = await fingerprint(peerSpki);
  return { forSender, forRecipient, keyId };
}

export async function openMessage(copy, privateKeyB64) {
  if (!copy?.ct || !copy?.iv) return { locked: 'malformed' };
  const joined = fromB64(copy.ct);
  if (joined.length <= WRAPPED_BYTES) return { locked: 'malformed' };
  const wrappedKey = joined.slice(0, WRAPPED_BYTES);
  const ciphertext = joined.slice(WRAPPED_BYTES);
  try {
    const privateKey = await importPrivateKey(privateKeyB64);
    const contentKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, wrappedKey);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(copy.iv) },
      await crypto.subtle.importKey('raw', contentKey, AES_ALG, false, ['decrypt']),
      ciphertext
    );
    return { text: dec.decode(plain) };
  } catch {
    return { locked: 'different-device' };
  }
}

export { b64 as toB64, fromB64 };