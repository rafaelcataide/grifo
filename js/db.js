// Camada de dados: IndexedDB no próprio aparelho.
// Cada gravação carimba "updatedAt" e cada exclusão deixa uma "lápide": é o que a sincronização na nuvem envia.
const DB_NAME = 'estante';
const VERSION = 2;
export const STORES = ['books', 'sessions', 'notes', 'cards', 'reviews'];
export const SYNC_KV = ['settings', 'badges', 'challenges'];
const TOMBS = '__tombstones';

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const d = req.result;
      // outra aba precisa atualizar ou apagar o banco: libera e recarrega em vez de travar as duas
      d.onversionchange = () => { d.close(); location.reload(); };
      resolve(d);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const getKV = (key) => tx('kv', 'readonly', (s) => s.get(key));
const rawSetKV = (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key));

async function addTombstones(list) {
  if (!list.length) return;
  const cur = (await getKV(TOMBS)) || [];
  await rawSetKV(TOMBS, [...cur, ...list]);
}

export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  // keepTs: grava como veio (usado ao aplicar mudanças vindas da nuvem)
  // uma edição sempre fica mais nova que a versão de onde partiu (mesmo com relógios desencontrados)
  put: (store, obj, { keepTs = false } = {}) => {
    if (!keepTs) obj.updatedAt = Math.max(Date.now(), (obj.updatedAt || 0) + 1);
    return tx(store, 'readwrite', (s) => s.put(obj));
  },
  bulkPut: (store, list, { keepTs = false } = {}) => {
    const now = Date.now();
    if (!keepTs) for (const o of list) o.updatedAt = Math.max(now, (o.updatedAt || 0) + 1);
    return tx(store, 'readwrite', (s) => { for (const o of list) s.put(o); });
  },
  del: async (store, id, { silent = false } = {}) => {
    const prev = silent ? null : await tx(store, 'readonly', (s) => s.get(id));
    await tx(store, 'readwrite', (s) => s.delete(id));
    if (!silent) await addTombstones([{ store, id, ts: Math.max(Date.now(), (prev?.updatedAt || 0) + 1) }]);
  },
  // tombstone: true apaga também na nuvem (substituir dados / apagar tudo)
  clear: async (store, { tombstone = false } = {}) => {
    if (tombstone) {
      const keys = await tx(store, 'readonly', (s) => s.getAllKeys());
      const ts = Date.now();
      await addTombstones(keys.map((id) => ({ store, id, ts })));
    }
    return tx(store, 'readwrite', (s) => s.clear());
  },
  getKV,
  setKV: async (key, value, { track = true } = {}) => {
    await rawSetKV(key, value);
    if (track && SYNC_KV.includes(key)) await rawSetKV(`__ts:${key}`, Date.now());
  },
  tombstones: async () => (await getKV(TOMBS)) || [],
  // Limpa o aparelho sem gerar lápides (ao sair da conta ou entrar com outra)
  wipeLocal: async () => {
    for (const s of STORES) await tx(s, 'readwrite', (st) => st.clear());
    for (const k of [...SYNC_KV, TOMBS, '__sync', 'lastReminder', ...SYNC_KV.map((x) => `__ts:${x}`)]) {
      await tx('kv', 'readwrite', (st) => st.delete(k));
    }
  },
  pruneTombstones: async (upTo) => rawSetKV(TOMBS, ((await getKV(TOMBS)) || []).filter((t) => t.ts > upTo)),
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
