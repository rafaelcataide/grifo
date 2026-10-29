// Estúdio de artes para Instagram (posts de citação, leitura, estante, retrospectiva, mapa, conquistas).
// Parte do app.js separada por tela: usa o estado e os utilitários do app (importados de ../app.js).
import { esc, nf, plainText } from '../util.js';
import { LOCALE, tr } from '../i18n.js';
import * as G from '../game.js';
import * as Cloud from '../cloud.js';
import { PURPOSE, state, $, fmtDate, bookById, noteById, toast, openModal, isPlus, render } from '../app.js';
import { graphApi } from './mapa.js';

// ---------------- estúdio de artes para Instagram ----------------
export const FORMATS = [{ id: 'story', label: '📱 Stories 9:16' }, { id: 'feed', label: '🖼️ Feed 4:5' }];

export function canvasFile(c, name) {
  return new Promise((resolve) => c.toBlob((b) => resolve(new File([b], name, { type: 'image/png' })), 'image/png'));
}

export const exportPlus = () => {
  if (isPlus()) return true;
  toast('⭐ Exportar para outros apps faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; });
  return false;
};
export const exportActions = {
  async exportMarkdown() {
    if (!exportPlus()) return;
    toast('📦 Preparando os arquivos…');
    try {
      const E = await import('../export.js');
      const data = { books: state.books, articles: state.articles, notes: state.notes };
      const files = [...E.markdownFiles(data), { path: 'Grifo - livros e artigos.csv', content: E.booksCsv(data) }];
      downloadFile(new File([await E.zip(files)], `grifo-${G.ymd()}.zip`, { type: 'application/zip' }));
      Cloud.track('export', { to: 'markdown' });
    } catch (e) { toast(`Não foi possível exportar: ${esc(e.message)}`, 'err'); }
  },
  async exportAnki() {
    if (!exportPlus()) return;
    if (!state.cards.length) { toast('Você ainda não tem cards para levar ao Anki.'); return; }
    const E = await import('../export.js');
    downloadFile(new File([E.ankiText({ books: state.books, articles: state.articles, cards: state.cards })], `grifo-anki-${G.ymd()}.txt`, { type: 'text/plain' }));
    Cloud.track('export', { to: 'anki' });
  },
};

export function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Pré-visualiza a(s) arte(s), troca estilo/formato e compartilha (Instagram, WhatsApp…) ou baixa
// Texto que acompanha a arte: com conta, leva o link de convite; sem conta, o endereço do app
export async function shareText(text) {
  let link = Cloud.siteUrl();
  try { const inv = await Cloud.myInvite(); if (inv?.code) link = Cloud.inviteLink(inv.code); } catch { /* sem convite: endereço simples */ }
  return `${text ? `${tr(text)}\n` : ''}${tr('Feito com Grifo:')} ${link}`;
}

export function shareStudio({ title, groups = [], render, filename = 'grifo', text = '', photo = false }) {
  if (isPlus()) groups = [...groups, { key: 'brand', options: [{ id: 'on', label: '🏷️ Com marca Grifo' }, { id: 'off', label: 'Só minha assinatura' }] }];
  const renderArt = render;
  render = (v, p) => { Share.prefs.brand = v.brand !== 'off'; return renderArt(v, p); };
  const values = Object.fromEntries(groups.map((g) => [g.key, g.value ?? g.options[0].id]));
  let photoImg = null, canvases = [], token = 0;
  openModal(`<div class="form studio">
    <div class="row between"><h3>${title}</h3><button type="button" class="icon-btn" data-action="close" aria-label="Fechar">✕</button></div>
    ${groups.map((g) => `<div class="radio-pills" data-group="${g.key}">${g.options.map((o) => `<input type="radio" name="sg-${g.key}" id="sg-${g.key}-${o.id}" value="${o.id}" ${values[g.key] === o.id ? 'checked' : ''}><label for="sg-${g.key}-${o.id}">${o.label}</label>`).join('')}</div>`).join('')}
    ${photo ? '<input type="file" accept="image/*" hidden id="studio-photo">' : ''}
    <div class="studio-preview busy" id="studio-preview"><span class="small muted">Desenhando…</span></div>
    <div class="actions"><button type="button" class="btn" id="studio-dl">⬇️ Baixar</button><button type="button" class="btn primary" id="studio-share">📤 Compartilhar</button></div>
    <p class="hint center" style="margin:0">No celular, “Compartilhar” abre Instagram, WhatsApp e outros apps.</p>
  </div>`, (root) => {
    const preview = $('#studio-preview', root);
    const name = (i) => `${filename}${canvases.length > 1 ? `-${i + 1}` : ''}.png`;
    const draw = async () => {
      const my = ++token;
      preview.classList.add('busy');
      try {
        const out = await render(values, photoImg);
        if (my !== token) return;
        canvases = Array.isArray(out) ? out : [out];
        preview.innerHTML = canvases.map((c, i) => `<img src="${c.toDataURL('image/jpeg', 0.85)}" alt="Arte ${i + 1} de ${canvases.length}">`).join('');
        preview.classList.toggle('multi', canvases.length > 1);
      } catch (e) {
        preview.innerHTML = `<p class="small muted">Não consegui gerar a imagem: ${esc(e.message)}</p>`;
      }
      if (my === token) preview.classList.remove('busy');
    };
    root.querySelectorAll('[data-group] input').forEach((inp) => {
      inp.onchange = () => {
        const key = inp.closest('[data-group]').dataset.group;
        const opt = groups.find((g) => g.key === key)?.options.find((o) => o.id === inp.value);
        if (opt?.locked) {
          $(`#sg-${key}-${values[key]}`, root).checked = true;
          toast('⭐ Esse estilo faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; });
          return;
        }
        values[key] = inp.value;
        if (photo && inp.value === 'foto' && !photoImg) $('#studio-photo', root).click();
        draw();
      };
    });
    if (photo) {
      $('#studio-photo', root).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        photoImg = await createImageBitmap(f, { imageOrientation: 'from-image' });
        draw();
      };
    }
    $('#studio-dl', root).onclick = async () => {
      Cloud.track('share', { kind: filename, via: 'download' });
      for (let i = 0; i < canvases.length; i++) downloadFile(await canvasFile(canvases[i], name(i)));
    };
    $('#studio-share', root).onclick = async () => {
      if (!canvases.length) return;
      const files = await Promise.all(canvases.map((c, i) => canvasFile(c, name(i))));
      Cloud.track('share', { kind: filename, via: 'share' });
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, text: await shareText(text) });
        } catch (e) {
          if (e.name !== 'AbortError') toast('Não foi possível compartilhar. Use “Baixar”.', 'err');
        }
      } else {
        files.forEach(downloadFile);
        toast('Imagem salva. Agora é só postar 📲');
      }
    };
    draw();
  });
}


export const shareActions = {
  postNote({ id }) {
    const n = noteById(id), b = bookById(n.bookId);
    shareStudio({
      title: '📸 Post da citação', filename: 'citacao', photo: true, text: b ? `${b.title}${b.author ? ` — ${b.author}` : ''}` : '',
      groups: [
        { key: 'style', options: Share.QUOTE_STYLES.map((o) => (Share.PLUS_STYLES.includes(o.id) && !isPlus() ? { ...o, label: `${o.label} 🔒`, locked: true } : o)) },
        { key: 'tone', options: Share.QUOTE_TONES.map((o) => (Share.PLUS_TONES.includes(o.id) && !isPlus() ? { ...o, label: `${o.label} 🔒`, locked: true } : o)) },
        { key: 'format', options: FORMATS },
      ],
      render: (v, photo) => Share.quoteCard({ text: plainText(n.text), title: b?.title || '', author: b?.author, page: n.page, style: v.style, tone: v.tone, format: v.format, handle: state.settings.handle, photo }),
    });
  },
  shareBook({ id }) {
    const b = bookById(id);
    shareStudio({
      title: b.status === 'finished' ? '📸 Terminei!' : '📸 Lendo agora', filename: 'lendo-agora',
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.readingCard({ book: b, streak: state.stats.streak, format: v.format, handle: state.settings.handle }),
    });
  },
  shareShelf() {
    const year = state.stats.year;
    shareStudio({
      title: '📸 Minha estante', filename: 'minha-estante',
      groups: [
        { key: 'style', options: Share.SHELF_STYLES },
        { key: 'period', options: [{ id: 'year', label: `Lidos em ${year}` }, { id: 'all', label: 'Todos os lidos' }] },
        { key: 'purpose', options: [{ id: 'all', label: 'Tudo' }, ...Object.entries(PURPOSE).map(([k, p]) => ({ id: k, label: `${p.icon} ${p.label}` }))] },
        { key: 'format', options: FORMATS },
      ],
      render: (v) => {
        const books = state.books
          .filter((b) => b.status === 'finished' && (v.period === 'all' || (b.endDate || '').startsWith(year)) && (v.purpose === 'all' || (b.purpose || 'hobby') === v.purpose))
          .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
        const pages = books.reduce((a, b) => a + (b.pages || 0), 0);
        const pLabel = v.purpose === 'all' ? '' : ` · ${PURPOSE[v.purpose].label}`;
        return Share.shelfCard({
          books, style: v.style, format: v.format, handle: state.settings.handle,
          heading: v.period === 'year' ? `Minha estante ${year}` : 'Minha estante',
          subheading: `${books.length} ${books.length === 1 ? 'livro' : 'livros'} · ${pages.toLocaleString(LOCALE)} páginas${pLabel}`,
        });
      },
    });
  },
  shareWrapped() {
    const monthStart = `${G.ymd().slice(0, 8)}01`;
    const hasMonth = state.sessions.some((s) => s.date >= monthStart) || state.books.some((b) => (b.endDate || '') >= monthStart);
    shareStudio({
      title: '✨ Sua retrospectiva', filename: 'retrospectiva', text: 'Minha retrospectiva de leituras',
      groups: [{ key: 'period', options: Share.PERIODS, value: hasMonth ? 'month' : 'year' }],
      render: (v) => Share.wrappedSlides(state, { period: v.period, name: state.settings.name, handle: state.settings.handle, xp: state.stats.xp, full: isPlus() }),
    });
  },
  shareMap() {
    const api = graphApi;
    if (!api) return;
    shareStudio({
      title: '📸 Minha rede de ideias', filename: 'mapa-mental',
      groups: [{ key: 'format', options: FORMATS, value: 'feed' }],
      render: async (v) => {
        await Share.ensureFonts();
        const [width, height] = Share.SIZES[v.format];
        const st = api.stats();
        return api.snapshot({ width, height, title: 'Minha rede de ideias', subtitle: `${st.books} livros · ${st.themes} temas · ${st.links} conexões`, handle: state.settings.handle, site: Share.siteLabel() });
      },
    });
  },
  shareBadge({ id }) {
    const b = G.BADGES.find((x) => x.id === id);
    shareStudio({
      title: `📸 ${b.name}`, filename: `conquista-${b.id}`,
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.achievementCard({ icon: b.icon, kicker: 'Conquista desbloqueada', title: b.name, subtitle: b.desc, foot: state.badges[id] ? `em ${fmtDate(state.badges[id])}` : '', format: v.format, handle: state.settings.handle }),
    });
  },
  shareLevel() {
    const s = state.stats, lv = G.levelInfo(s.xp);
    shareStudio({
      title: '📸 Meu nível', filename: `nivel-${lv.level}`,
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.achievementCard({ icon: '⭐', kicker: `Nível ${lv.level}`, title: lv.title, subtitle: `${nf(s.xp)} XP em leituras, notas e revisões`, foot: `${s.finished} livros · ${nf(s.totalPages)} páginas`, format: v.format, handle: state.settings.handle }),
    });
  },
  shareStreak() {
    const s = state.stats;
    shareStudio({
      title: '📸 Minha sequência', filename: 'sequencia',
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.achievementCard({ icon: '🔥', kicker: 'Sequência de leitura', title: `${s.streak} dias seguidos`, subtitle: 'lendo todos os dias, sem pular nenhum', foot: `recorde: ${s.longest} dias`, format: v.format, handle: state.settings.handle }),
    });
  },
};
// As artes (share.js, ~47 KB) só são baixadas ao criar um post: cada ação carrega o módulo antes
export let Share = null;
for (const [k, fn] of Object.entries(shareActions)) {
  shareActions[k] = async (...args) => { Share ||= await import('../share.js'); return fn.apply(shareActions, args); };
}
