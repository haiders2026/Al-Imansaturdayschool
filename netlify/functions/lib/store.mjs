// Key/value storage. On Netlify this uses Netlify Blobs (no database to set up).
// For local development, set LOCAL_DATA_DIR and data is kept as files on disk.
import { promises as fs } from "node:fs";
import path from "node:path";

let backend;

function fileBackend(dir) {
  const enc = (key) => path.join(dir, encodeURIComponent(key));
  const dec = (name) => decodeURIComponent(name);
  return {
    async getJSON(key) {
      try { return JSON.parse(await fs.readFile(enc(key), "utf8")); } catch { return null; }
    },
    async setJSON(key, value) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(enc(key), JSON.stringify(value));
    },
    async del(key) { await fs.rm(enc(key), { force: true }); await fs.rm(enc(key) + ".meta", { force: true }); },
    async list(prefix = "") {
      await fs.mkdir(dir, { recursive: true });
      return (await fs.readdir(dir)).map(dec).filter((k) => k.startsWith(prefix) && !k.endsWith(".meta"));
    },
    async setFile(key, buffer, metadata) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(enc(key), Buffer.from(buffer));
      await fs.writeFile(enc(key) + ".meta", JSON.stringify(metadata || {}));
    },
    async getFile(key) {
      try {
        const data = await fs.readFile(enc(key));
        const metadata = JSON.parse(await fs.readFile(enc(key) + ".meta", "utf8"));
        return { data, metadata };
      } catch { return null; }
    },
  };
}

// Netlify hands each request a short-lived Blobs access token, so the store must be opened per
// request. Keeping one store across requests worked at first but failed with an error once the
// function had been idle for a few minutes and its saved token had expired.
let getStore;
async function blobsBackend() {
  getStore ||= (await import("@netlify/blobs")).getStore;
  const store = getStore({ name: "school", consistency: "strong" });
  return {
    getJSON: (key) => store.get(key, { type: "json" }),
    setJSON: (key, value) => store.setJSON(key, value),
    del: (key) => store.delete(key),
    async list(prefix = "") {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
    setFile: (key, buffer, metadata) => store.set(key, buffer, { metadata }),
    async getFile(key) {
      const res = await store.getWithMetadata(key, { type: "arrayBuffer" });
      return res ? { data: Buffer.from(res.data), metadata: res.metadata } : null;
    },
  };
}

export async function db() {
  if (process.env.LOCAL_DATA_DIR) return (backend ||= fileBackend(process.env.LOCAL_DATA_DIR));
  return blobsBackend();
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// A "collection" is a list of records saved under one key, e.g. "students".
export async function all(name) {
  return (await (await db()).getJSON(name)) || [];
}
export async function saveAll(name, rows) {
  await (await db()).setJSON(name, rows);
  return rows;
}
export async function findById(name, id) {
  return (await all(name)).find((r) => r.id === id) || null;
}
export async function upsert(name, record) {
  const rows = await all(name);
  const now = new Date().toISOString();
  const i = record.id ? rows.findIndex((r) => r.id === record.id) : -1;
  let saved;
  if (i >= 0) {
    saved = { ...rows[i], ...record, updatedAt: now };
    rows[i] = saved;
  } else {
    saved = { ...record, id: record.id || newId(), createdAt: now };
    rows.push(saved);
  }
  await saveAll(name, rows);
  return saved;
}
export async function remove(name, id) {
  const rows = await all(name);
  await saveAll(name, rows.filter((r) => r.id !== id));
}
