/**
 * Encryption at rest for entries waiting on this device (AES-GCM 256).
 *
 * The key is created by the browser as NON-EXTRACTABLE and kept in IndexedDB, so the key bytes can
 * never be read back by script or copied from disk. Someone who copies the browser's localStorage
 * gets only ciphertext. (This does not protect against malicious script running inside the page.)
 */
export interface Cipher {
  encrypt(plain: string): Promise<string>;
  decrypt(blob: string): Promise<string>;
}

const DB = "kusbill-secure";
const STORE = "keys";
const KEY_ID = "offlineQueue";

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type KeyProvider = () => Promise<CryptoKey>;

/** Builds a cipher around any key source (the browser one below, or a plain in-memory key in tests). */
export function createCipher(getKey: KeyProvider): Cipher {
  return {
    async encrypt(plain) {
      const key = await getKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
      return JSON.stringify({ v: 2, iv: b64(iv), d: b64(data) });
    },
    async decrypt(blob) {
      const o = JSON.parse(blob) as { v: number; iv: string; d: string };
      if (o.v !== 2) throw new Error("Unsupported format");
      const key = await getKey();
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.d));
      return new TextDecoder().decode(plain);
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The device key: created once, stored as a non-extractable CryptoKey in IndexedDB. */
export const browserKey: KeyProvider = async () => {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(KEY_ID);
    r.onsuccess = () => res(r.result as CryptoKey | undefined);
    r.onerror = () => rej(r.error);
  });
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  // Another tab may have created a key in the meantime; keep whichever got there first.
  const winner = await new Promise<CryptoKey>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get = store.get(KEY_ID);
    get.onsuccess = () => { if (get.result) res(get.result as CryptoKey); else { store.put(key, KEY_ID); res(key); } };
    tx.onerror = () => rej(tx.error);
  });
  return winner;
};

export function browserCipherAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

export const browserCipher = (): Cipher => createCipher(browserKey);
