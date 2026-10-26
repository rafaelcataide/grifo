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

// ---------------- convites ----------------
// O link ?convite=CÓDIGO é guardado antes do login (a volta do Google chega sem ele) e usado logo depois.
const INVITE_KEY = 'grifo.invite';
const inviteListeners = new Set();
export const onInvite = (fn) => inviteListeners.add(fn);
export function pendingInvite() {
  try { return localStorage.getItem(INVITE_KEY); } catch { return null; }
}
(function captureInvite() {
  const params = new URLSearchParams(location.search);
  const code = params.get('convite');
  if (!code) return;
  try { localStorage.setItem(INVITE_KEY, code.trim().slice(0, 20)); } catch { /* sem armazenamento */ }
  params.delete('convite');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
})();
async function redeemPendingInvite(sb) {
  const code = pendingInvite();
  if (!code) return;
  const { data, error } = await sb.rpc('redeem_invite', { code });
  if (error) return; // tenta de novo no próximo login
  try { localStorage.removeItem(INVITE_KEY); } catch { /* sem armazenamento */ }
  if (data === 'ok') {
    const { data: plan } = await sb.rpc('my_plan');
    if (profile) profile.plan = plan || profile.plan;
  }
  inviteListeners.forEach((fn) => fn(data));
}
let invite = null;
export async function myInvite(refresh = false) {
  const sb = await client();
  if (!sb || !user()) return null;
  if (invite && !refresh) return invite;
  const { data, error } = await sb.rpc('my_invite');
  if (error) throw error;
  invite = data;
  return invite;
}
// endereço do app para divulgar (config.siteUrl ou o próprio endereço aberto)
export const siteUrl = () => CONFIG.siteUrl || location.origin + location.pathname;
export const inviteLink = (code) => `${siteUrl()}${code ? `?convite=${code}` : ''}`;

// ---------------- eventos de uso e métricas ----------------
// Só nome e poucos detalhes (ex.: tipo de arte), nunca conteúdo das notas
export async function track(name, props = {}) {
  try {
    const sb = await client();
    if (!sb || !user()) return;
    await sb.from('events').insert({ name, props });
  } catch { /* métrica nunca atrapalha o uso */ }
}
let admin = null;
export async function isAdmin() {
  const sb = await client();
  if (!sb || !user()) return false;
  if (admin === null) admin = !!(await sb.rpc('am_i_admin')).data;
  return admin;
}
export async function adminMetrics() {
  const sb = await client();
  const { data, error } = await sb.rpc('admin_metrics');
  if (error) throw error;
  return data;
}
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
    if (changed) { profile = null; invite = null; admin = null; if (s) loadProfile().then(() => redeemPendingInvite(sb)).catch(() => {}).then(emit); }
    emit();
  });
  if (session) { await loadProfile(); await redeemPendingInvite(sb).catch(() => {}); }
}

export async function signInWithGoogle() {
  const sb = await client();
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function sendEmailCode(email, captchaToken) {
  const sb = await client();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken } });
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
// Só estas colunas são legíveis; o plano de cada um vem da função my_plan()
const PROFILE_COLS = 'user_id,handle,display_name,avatar_url,is_public,stats,updated_at';

async function loadProfile() {
  const sb = await client();
  const u = user();
  if (!sb || !u) return null;
  let { data } = await sb.from('profiles').select(PROFILE_COLS).eq('user_id', u.id).maybeSingle();
  if (!data) {
    const meta = u.user_metadata || {};
    const row = { user_id: u.id, display_name: meta.full_name || meta.name || (u.email || '').split('@')[0], avatar_url: meta.avatar_url || meta.picture || null };
    ({ data } = await sb.from('profiles').insert(row).select(PROFILE_COLS).maybeSingle());
    data ||= { ...row, is_public: false, stats: {} };
  }
  const [{ data: plan }, { data: weekly }] = await Promise.all([sb.rpc('my_plan'), sb.rpc('my_weekly_email')]);
  profile = { ...data, plan: plan || 'free', weekly_email: !!weekly };
  return profile;
}

export async function updateProfile(patch) {
  const sb = await client();
  const { data, error } = await sb.from('profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', user().id).select(PROFILE_COLS).maybeSingle();
  if (error) throw error;
  profile = { ...data, plan: profile?.plan || 'free', weekly_email: !!profile?.weekly_email };
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
  const { data } = await sb.from('profiles').update({ stats, updated_at: new Date().toISOString() }).eq('user_id', user().id).select(PROFILE_COLS).maybeSingle();
  if (data) profile = { ...data, plan: profile.plan, weekly_email: profile.weekly_email };
}

// ---------------- clubes ----------------
export async function myClubs() {
  const sb = await client();
  const { data, error } = await sb.from('clubs').select('id,name,code,goal_pages,owner,current_book,club_members(user_id)').order('created_at');
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

// ----- grifos compartilhados no clube -----
export async function clubPosts(clubId, limit = 20) {
  const sb = await client();
  const { data, error } = await sb.from('club_posts').select('id,user_id,text,book_title,book_author,page,created_at')
    .eq('club_id', clubId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

export async function postToClub(clubId, { text, book_title, book_author, page }) {
  const sb = await client();
  const { error } = await sb.from('club_posts').insert({ club_id: clubId, text: text.slice(0, 1500), book_title, book_author, page: page || null });
  if (error) throw error;
}

export async function deleteClubPost(id) {
  const sb = await client();
  const { error } = await sb.from('club_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function setClubBook(clubId, title) {
  const sb = await client();
  const { error } = await sb.from('clubs').update({ current_book: title.slice(0, 200) || null }).eq('id', clubId);
  if (error) throw error;
}

export async function setWeeklyEmail(on) {
  const sb = await client();
  const { error } = await sb.rpc('set_weekly_email', { on_off: !!on });
  if (error) throw error;
  if (profile) profile.weekly_email = !!on;
}

// ---------------- notificações pelo servidor (Web Push) ----------------
export async function savePush(subscription, { tz, time, enabled }) {
  const sb = await client();
  const j = subscription.toJSON();
  const { error } = await sb.from('push_subscriptions')
    .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz, remind_time: time, enabled }, { onConflict: 'endpoint' });
  if (error) throw error;
}

// Ao sair da conta, este aparelho para de receber os avisos dela
export async function removePush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    const sb = await client();
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  } catch { /* sem rede: a inscrição expira sozinha quando falhar no envio */ }
}

// ---------------- conta: exclusão, erros e sugestões ----------------
export async function deleteAccount() {
  const sb = await client();
  const { error } = await sb.functions.invoke('delete-account', { body: { confirm: 'EXCLUIR' } });
  if (error) {
    let body = null;
    try { body = await error.context?.json(); } catch { /* sem corpo */ }
    throw new Error(body?.message || 'Não foi possível excluir a conta agora.');
  }
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  session = null;
  profile = null;
  emit();
}

// Registra erros do app para você ver no painel (sem dados de leitura; no máx. 5 por sessão)
let errorsSent = 0;
const seenErrors = new Set();
export async function reportError(message, stack, version) {
  if (!enabled() || errorsSent >= 5) return;
  const key = `${message}|${(stack || '').slice(0, 120)}`;
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  errorsSent++;
  try {
    const sb = await client();
    await sb.from('client_errors').insert({
      message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 4000),
      url: location.hash.slice(0, 300), user_agent: navigator.userAgent.slice(0, 300), version,
    });
  } catch { /* sem rede: ignora */ }
}

export async function sendFeedback(kind, message, version) {
  const sb = await client();
  const { error } = await sb.from('feedback').insert({ kind, message, version });
  if (error) throw error;
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

// ---------------- artigos ----------------
// O servidor baixa a página e devolve o texto limpo (o navegador não pode buscar outros sites direto)
export async function fetchArticle(url) {
  const sb = await client();
  const { data, error } = await sb.functions.invoke('article', { body: { url } });
  if (error) {
    let body = null;
    try { body = await error.context?.json(); } catch { /* sem corpo */ }
    throw new Error(body?.message || 'Não consegui buscar esse artigo agora.');
  }
  return data;
}
