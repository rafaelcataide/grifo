// Nuvem (Supabase): conta com Google ou código por e-mail, sincronização entre aparelhos,
// perfil público, clubes de leitura e a função de IA. Sem configuração, o app segue 100% local.
import { CONFIG } from '../config.js';
import { db, STORES, SYNC_KV } from './db.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const SECRET_SETTINGS = ['googleKey', 'aiKey']; // chaves pessoais não sobem para a nuvem
const EPOCH = '1970-01-01T00:00:00Z';

export const enabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

let clientPromise = null;
export function client() {
  if (!enabled()) return Promise.resolve(null);
  clientPromise ||= import(SUPABASE_ESM).then(({ createClient }) => createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  }));
  return clientPromise;
}

// ---------------- conta ----------------
let session = null;
let profile = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export const user = () => session?.user || null;
export const currentProfile = () => profile;

export async function init() {
  const sb = await client();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  session = data.session;
  // limpa o ?code= que volta do login com Google
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + (location.hash || '#/'));
  sb.auth.onAuthStateChange((_event, s) => {
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (changed) { profile = null; if (s) loadProfile().then(emit); }
    emit();
  });
  if (session) await loadProfile();
}

export async function signInWithGoogle() {
  const sb = await client();
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function sendEmailCode(email) {
  const sb = await client();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyEmailCode(email, token) {
  const sb = await client();
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  session = null;
  profile = null;
  emit();
}

// ---------------- perfil e plano ----------------
async function loadProfile() {
  const sb = await client();
  const u = user();
  if (!sb || !u) return null;
  const { data } = await sb.from('profiles').select('*').eq('user_id', u.id).maybeSingle();
  if (data) { profile = data; return data; }
  const meta = u.user_metadata || {};
  const row = { user_id: u.id, display_name: meta.full_name || meta.name || (u.email || '').split('@')[0], avatar_url: meta.avatar_url || meta.picture || null };
  const { data: created } = await sb.from('profiles').insert(row).select().maybeSingle();
  profile = created || { ...row, plan: 'free', is_public: false, stats: {} };
  return profile;
}

export async function updateProfile(patch) {
  const sb = await client();
  const { data, error } = await sb.from('profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', user().id).select().maybeSingle();
  if (error) throw error;
  profile = data;
  emit();
  return data;
}

export async function publicProfile(handle) {
  const sb = await client();
  const { data } = await sb.from('profiles').select('handle, display_name, avatar_url, stats, is_public').eq('handle', handle.toLowerCase()).maybeSingle();
  return data;
}

// "personal": sem servidor (tudo liberado) · "plus" · "free"
export function plan() {
  if (!enabled()) return 'personal';
  return profile?.plan === 'plus' ? 'plus' : 'free';
}

// ---------------- sincronização ----------------
let syncing = null;
let lastSyncAt = 0;
let lastError = null;
export const syncStatus = () => ({ syncing: !!syncing, lastSyncAt, lastError });

const stripSecrets = (v) => {
  if (!v || typeof v !== 'object') return v;
  const copy = { ...v };
  for (const k of SECRET_SETTINGS) delete copy[k];
  return copy;
};

// Puxa o que mudou na nuvem, aplica o que for mais novo e envia o que mudou aqui.
// Devolve true se algo foi aplicado localmente (o app recarrega o estado).
export function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const sb = await client();
    const u = user();
    if (!sb || !u) return false;
    const startedAt = Date.now();
    let meta = (await db.getKV('__sync')) || {};
    // dados de OUTRA conta neste aparelho nunca vão para esta: limpa antes de baixar os desta conta
    const switched = !!(meta.user && meta.user !== u.id);
    if (switched) await db.wipeLocal();
    if (meta.user !== u.id) meta = { user: u.id, cursor: EPOCH, lastPush: 0 }; // primeira vez nesta conta: envia o que for do aparelho

    // 1) puxar
    let applied = false;
    let cursor = meta.cursor;
    const since = new Date(new Date(cursor).getTime() - 5000).toISOString(); // pequena sobreposição: transações concorrentes
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await sb.from('records').select('store,id,data,deleted,client_ts,synced_at')
        .gt('synced_at', since).order('synced_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      for (const r of rows) {
        if (r.synced_at > cursor) cursor = r.synced_at;
        if (r.store === 'kv') {
          if (!SYNC_KV.includes(r.id)) continue;
          const localTs = (await db.getKV(`__ts:${r.id}`)) || 0;
          if (r.client_ts <= localTs) continue;
          let value = r.data;
          if (r.id === 'settings') {
            const local = (await db.getKV('settings')) || {};
            value = { ...value, ...Object.fromEntries(SECRET_SETTINGS.filter((k) => local[k]).map((k) => [k, local[k]])) };
          }
          await db.setKV(r.id, value, { track: false });
          await db.setKV(`__ts:${r.id}`, r.client_ts, { track: false });
          applied = true;
        } else if (STORES.includes(r.store)) {
          const local = await db.get(r.store, r.id);
          if (local && (local.updatedAt || 0) >= r.client_ts) continue;
          if (r.deleted) { if (local) await db.del(r.store, r.id, { silent: true }); } else await db.put(r.store, { ...r.data, updatedAt: r.client_ts }, { keepTs: true });
          applied = true;
        }
      }
      if (rows.length < 1000) break;
    }

    // 2) enviar
    // na primeira sincronização da conta vai tudo, inclusive itens antigos sem carimbo de data
    const firstPush = meta.lastPush === 0;
    const changes = [];
    for (const store of STORES) {
      for (const o of await db.all(store)) {
        if (firstPush || (o.updatedAt || 0) > meta.lastPush) changes.push({ store, id: o.id, data: o, deleted: false, client_ts: o.updatedAt || o.createdAt || 1 });
      }
    }
    for (const key of SYNC_KV) {
      const ts = (await db.getKV(`__ts:${key}`)) || 0;
      const value = await db.getKV(key);
      if ((firstPush && value !== undefined) || ts > meta.lastPush) changes.push({ store: 'kv', id: key, data: stripSecrets(value), deleted: false, client_ts: ts || 1 });
    }
    for (const t of await db.tombstones()) {
      if (t.ts > meta.lastPush) changes.push({ store: t.store, id: t.id, data: null, deleted: true, client_ts: t.ts });
    }
    for (let i = 0; i < changes.length; i += 400) {
      const { error } = await sb.rpc('push_records', { rows: changes.slice(i, i + 400) });
      if (error) throw error;
    }
    await db.pruneTombstones(startedAt);
    await db.setKV('__sync', { user: u.id, cursor, lastPush: startedAt }, { track: false });
    lastSyncAt = Date.now();
    lastError = null;
    return applied || switched; // trocou de conta: o app recarrega mesmo sem nada novo na nuvem
  })().catch((e) => { lastError = e.message || String(e); throw e; })
    .finally(() => { syncing = null; emit(); });
  return syncing;
}

// Estatísticas que aparecem no perfil público e no ranking dos clubes
export async function publishStats(stats) {
  if (!user() || !profile) return;
  const same = JSON.stringify(profile.stats || {}) === JSON.stringify(stats);
  if (same) return;
  const sb = await client();
  const { data } = await sb.from('profiles').update({ stats, updated_at: new Date().toISOString() }).eq('user_id', user().id).select().maybeSingle();
  if (data) profile = data;
}

// ---------------- clubes ----------------
export async function myClubs() {
  const sb = await client();
  const { data, error } = await sb.from('clubs').select('id,name,code,goal_pages,owner,club_members(user_id)').order('created_at');
  if (error) throw error;
  return data;
}

export async function createClub(name, goalPages) {
  const sb = await client();
  const { data, error } = await sb.from('clubs').insert({ name, goal_pages: goalPages }).select().single();
  if (error) throw error;
  const { error: e2 } = await sb.from('club_members').insert({ club_id: data.id });
  if (e2) throw e2;
  return data;
}

export async function joinClub(code) {
  const sb = await client();
  const { data, error } = await sb.rpc('join_club', { invite: code });
  if (error) throw new Error(error.message.includes('inválido') ? 'Código de convite inválido.' : error.message);
  return data;
}

export async function leaveClub(clubId) {
  const sb = await client();
  const { error } = await sb.from('club_members').delete().eq('club_id', clubId).eq('user_id', user().id);
  if (error) throw error;
}

export async function clubMembers(clubId) {
  const sb = await client();
  const { data: members, error } = await sb.from('club_members').select('user_id').eq('club_id', clubId);
  if (error) throw error;
  const ids = members.map((m) => m.user_id);
  const { data: profiles } = await sb.from('profiles').select('user_id,handle,display_name,avatar_url,stats').in('user_id', ids);
  return profiles || [];
}

// ---------------- IA pelo servidor ----------------
export async function invokeAI(task, input) {
  const sb = await client();
  const { data, error } = await sb.functions.invoke('ai', { body: { task, input } });
  if (error) {
    let body = null;
    try { body = await error.context?.json(); } catch { /* sem corpo */ }
    const e = new Error(body?.message || 'Não foi possível falar com a IA.');
    e.code = body?.error || 'erro';
    throw e;
  }
  return data;
}
