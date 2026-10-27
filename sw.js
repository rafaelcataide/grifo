// Service worker: app funciona offline depois da primeira visita.
const CACHE = 'grifo-v35';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/i18n.js', 'js/i18n-en.js', 'js/icons.js', 'js/landing.js', 'js/export.js', 'js/pdf.js', 'icons/ui.svg', 'js/db.js', 'js/game.js', 'js/ocr.js', 'js/charts.js', 'js/graph.js', 'js/srs.js', 'js/share.js', 'js/scanner.js', 'js/importers.js', 'js/cloud.js', 'js/ai.js', 'config.js', 'supabase/functions/_shared/ai-tasks.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/og.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' busca direto no servidor, sem reaproveitar cópias antigas do navegador
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Arquivos do app: rede primeiro (pega atualizações), cache como reserva.
  // "no-cache" revalida com o servidor: o GitHub Pages manda o navegador guardar arquivos por 10 min.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' }))
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Motor de OCR (Tesseract) e fontes das artes: cache primeiro, para funcionar offline depois do primeiro uso.
  if (['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});

// ---------------- lembretes ----------------
// Com o app instalado (Chrome no Android), o navegador acorda o service worker periodicamente
// e decidimos aqui se vale lembrar: ainda não leu hoje e já passou do horário escolhido.
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('estante');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const idbReq = (store, mode, fn) => idb().then((d) => new Promise((resolve, reject) => {
  if (!d.objectStoreNames.contains(store)) return resolve(undefined);
  const t = d.transaction(store, mode);
  const r = fn(t.objectStore(store));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
}));
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function checkReminder(force = false) {
  const settings = (await idbReq('kv', 'readonly', (s) => s.get('settings'))) || {};
  const rem = settings.reminder || {};
  if (!force && !rem.enabled) return;
  // com conta, o servidor já manda o aviso (Web Push): não repetir aqui
  if (!force && (await idbReq('kv', 'readonly', (s) => s.get('pushActive')))) return;
  const today = ymd();
  if (!force && (await idbReq('kv', 'readonly', (s) => s.get('lastReminder'))) === today) return;
  const [h, m] = String(rem.time || '20:00').split(':').map(Number);
  const now = new Date();
  if (!force && now.getHours() * 60 + now.getMinutes() < h * 60 + (m || 0)) return;

  const sessions = (await idbReq('sessions', 'readonly', (s) => s.getAll())) || [];
  const cards = (await idbReq('cards', 'readonly', (s) => s.getAll())) || [];
  const days = new Set(sessions.filter((x) => x.pages > 0).map((x) => x.date));
  const due = cards.filter((c) => c.due <= today).length;
  let streak = 0;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (days.has(ymd(d))) { streak++; d.setDate(d.getDate() - 1); }

  let title, body, url = './#/';
  if (!days.has(today)) {
    title = streak ? `🔥 Não perca sua sequência de ${streak} ${streak === 1 ? 'dia' : 'dias'}!` : '📚 Hora da leitura';
    body = `Que tal ${settings.dailyGoal || 20} páginas hoje?${due ? ` E ainda tem ${due} cards para revisar.` : ''}`;
  } else if (due) {
    title = `🧠 ${due} ${due === 1 ? 'card' : 'cards'} para revisar`;
    body = 'Leva poucos minutos e fixa o que você leu.';
    url = './#/revisar';
  } else if (!force) return;
  else { title = '✅ Tudo em dia!'; body = 'Você já leu hoje e não há cards pendentes.'; }

  await self.registration.showNotification(title, {
    body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'estante-lembrete', data: { url },
  });
  if (!force) await idbReq('kv', 'readwrite', (s) => s.put(today, 'lastReminder'));
}

// Aviso enviado pelo servidor (função push-daily)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Grifo', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'estante-lembrete', data: { url: d.url || './#/' },
  }));
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'estante-lembrete') e.waitUntil(checkReminder());
});

self.addEventListener('message', (e) => {
  if (e.data === 'test-reminder') e.waitUntil(checkReminder(true));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.navigate(url); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
