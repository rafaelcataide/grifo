// Artigos salvos por link e PDFs: leitores, grifar, fila de leitura.
// Parte do app.js separada por tela: usa o estado e os utilitários do app (importados de ../app.js).
import { LINK_RE, esc, norm, plainText } from '../util.js';
import { db, uid } from '../db.js';
import { lang } from '../i18n.js';
import * as G from '../game.js';
import * as Cloud from '../cloud.js';
import * as AI from '../ai.js';
import { PURPOSE, state, $, view, srcHref, sources, noteById, empty, conceptHref, seg, persist, remove, commit, toast, openModal, closeModal, READ_SEG, cover, noteCard, isPlus, aiRun, datalist, themeOptions, subthemeOptions, noteForm, actions, render } from '../app.js';
import { wordLookup } from './vocabulario.js';

// ---------- artigos salvos por link ----------
export const FREE_ARTICLES = 10;
export const SHARED_KEY = 'grifo.shared';

// tempo de leitura (~200 palavras por minuto) e quanto já foi lido (guardado neste aparelho)
export const readMinutes = (a) => Math.max(1, Math.round((a.blocks || []).reduce((n, b) => n + b.x.split(/\s+/).length, 0) / 200));
export const POS_KEY = (id) => `grifo.artpos.${id}`;
export function readPos(id) {
  try { return JSON.parse(localStorage.getItem(POS_KEY(id))) || { p: 0, y: 0 }; } catch { return { p: 0, y: 0 }; }
}
export const ART_QUEUE = { want: 'Ler depois', reading: 'Lendo', finished: 'Lidos' };

// artigo ou PDF começado: marcado como lendo ou com parte do texto já lida
export const articleStarted = (a) => a.status !== 'finished' && (a.status === 'reading' || readPos(a.id).p > 0.05);
export function articleItem(a) {
  const notes = state.notes.filter((n) => n.bookId === a.id).length;
  const pos = readPos(a.id).p;
  const status = a.status === 'finished' ? '<span class="chip">✓ Lido</span>'
    : articleStarted(a) ? `<span class="chip p-academic">Lendo${pos > 0.05 ? ` · ${Math.round(pos * 100)}%` : ''}</span>` : '<span class="chip">Ler depois</span>';
  return `<a class="card book art-item" href="${srcHref(a)}">
      ${a.cover ? `<img class="art-thumb" src="${esc(a.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="art-thumb ph">${a.kind === 'pdf' ? '📄' : '📰'}</span>`}
      <div class="grow"><div class="book-title">${esc(a.title)}</div>
        <div class="small muted">${a.kind === 'pdf' ? `PDF · ${a.pages || '?'} páginas` : `${esc(a.site || '')} · ${readMinutes(a)} min`}${notes ? ` · ${notes} ${notes === 1 ? 'grifo' : 'grifos'}` : ''}</div>
        <div class="chips" style="margin-top:4px">${status}${a.genre ? `<span class="chip tag">${esc(a.genre)}</span>` : ''}</div></div></a>`;
}

export function articlesView() {
  const filter = sessionStorage.getItem('artFilter') || 'all';
  const all = [...state.articles].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const list = filter === 'all' ? all : all.filter((a) => (a.status || 'want') === filter);
  const count = (k) => all.filter((a) => (a.status || 'want') === k).length;
  return `${seg(READ_SEG, 'articles')}
  <h2>Artigos e PDFs</h2>
  <form class="row gap-s" id="art-form"><input name="url" type="url" class="search grow" required placeholder="Cole o link de um artigo…" autocomplete="off" style="margin:0"><button class="btn primary" id="art-save">Salvar</button></form>
  <div class="row gap-s wrap" style="margin-top:8px"><button class="btn" data-action="addPdf">📄 Adicionar PDF</button><input type="file" id="pdf-file" accept="application/pdf,.pdf" hidden></div>
  <p class="hint">No celular, em qualquer site ou app de notícias: <b>Compartilhar → Grifo</b>. Depois é só selecionar um trecho e tocar em <b>Grifar</b>.</p>
  ${!isPlus() ? `<p class="small muted">${state.articles.length} de ${FREE_ARTICLES} artigos do plano grátis · <a href="#/plus">ilimitados no Plus</a></p>` : ''}
  ${all.length ? `<div class="tabs">${[['all', `Todos (${all.length})`], ...Object.entries(ART_QUEUE).map(([k, v]) => [k, `${v} (${count(k)})`])]
    .map(([k, v]) => `<button class="tab ${filter === k ? 'active' : ''}" data-action="artFilter" data-v="${k}">${v}</button>`).join('')}</div>` : ''}
  ${list.length ? list.map(articleItem).join('')
    : all.length ? '<p class="nudge">Nenhum artigo aqui.</p>' : empty('Salve artigos, posts e notícias para ler, grifar e conectar com seus livros.')}`;
}
articlesView.mount = () => {
  const form = $('#art-form');
  form.onsubmit = (e) => { e.preventDefault(); actions.saveArticle({ url: form.url.value.trim() }); };
};

// Finalidade, tema e subtema do artigo (como nos livros), com o botão para mudar
export function articleTags(a) {
  const pp = PURPOSE[a.purpose || 'hobby'];
  const parts = [a.genre, a.subtheme].filter(Boolean);
  return parts.length
    ? `<div class="chips art-tags"><span class="chip p-${a.purpose || 'hobby'}">${pp.icon} ${pp.label}</span>${parts.map((x) => `<a class="chip tag" href="${conceptHref(x)}">${esc(x)}</a>`).join('')}<button class="chip chip-btn" data-action="classifyArticle" data-id="${a.id}">✏️ Editar</button></div>`
    : `<button class="card art-classify" data-action="classifyArticle" data-id="${a.id}">🏷️ <span><b>Classifique este artigo</b><br><span class="small muted">Finalidade, tema e subtema: ele passa a aparecer no mapa, nos filtros e junto dos livros do mesmo tema.</span></span></button>`;
}

// O Grifo não conseguiu ler a página (site com proteção contra robôs, login, link de PDF…):
// oferece baixar o PDF no próprio site e adicionar, ou guardar só o link com o nome escolhido
export function articleFallback(url, why) {
  const guess = decodeURIComponent(url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '').replace(/\.(html?|pdf|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').trim();
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  openModal(`<form class="form" id="artfb-form"><h3>📰 Não consegui ler essa página</h3>
    <p class="small muted" style="margin:0">${esc(why || '')} Alguns sites (como o SciELO) bloqueiam leitores automáticos.</p>
    <div class="card" style="margin:0"><b>📄 Melhor opção: o PDF</b>
      <p class="small" style="margin:4px 0 8px">Abra o site, baixe o PDF do artigo e adicione aqui. Você grifa no próprio PDF.</p>
      <div class="row gap-s wrap"><a class="btn small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ Abrir o site</a><button type="button" class="btn small primary" id="artfb-pdf">📄 Adicionar PDF</button></div></div>
    <div class="card" style="margin:0"><b>🔗 Ou guarde só o link</b>
      <label style="margin-top:6px">Nome <input name="title" required value="${esc(guess)}" placeholder="Título do artigo"></label>
      <span class="hint">Fica na fila “Ler depois”, com o link para o original. Dá para criar notas nele.</span></div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn">Salvar só o link</button></div>
  </form>`, (root) => {
    const form = $('#artfb-form', root);
    $('#artfb-pdf', root).onclick = () => { closeModal(); actions.addPdf(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const art = {
        id: uid(), createdAt: Date.now(), kind: 'article', status: 'want', purpose: 'hobby', genre: '', subtheme: '', pages: 0, currentPage: 0, rating: 0, isbn: '',
        title: form.title.value.trim(), author: '', site: host, url, sourceUrl: url, blocks: [], linkOnly: true,
      };
      closeModal();
      await commit(() => persist('books', art));
      location.hash = `#/artigo/${art.id}`;
    };
  });
}

// Marca no texto os trechos já grifados (as notas de citação deste artigo)
export function markHighlights(html, quotes) {
  let out = html;
  for (const q of quotes) {
    const h = esc(q);
    if (h.length >= 3 && out.includes(h)) out = out.replace(h, `<mark>${h}</mark>`);
  }
  return out;
}

export function articleView(id) {
  const a = state.articles.find((x) => x.id === id);
  if (!a) return `<a href="#/artigos" class="back">← Artigos</a>${empty('Artigo não encontrado.')}`;
  const notes = state.notes.filter((n) => n.bookId === id).sort((x, y) => x.createdAt - y.createdAt);
  const quotes = notes.filter((n) => n.kind === 'quote').map((n) => plainText(n.text));
  const tag = { h: 'h3', q: 'blockquote', li: 'li', p: 'p' };
  const body = (a.blocks || []).map((b) => `<${tag[b.t] || 'p'}>${markHighlights(esc(b.x), quotes)}</${tag[b.t] || 'p'}>`).join('');
  return `<a href="#/artigos" class="back">← Artigos</a>
  <article class="reader">
    <div class="small muted">${esc([a.site, a.author, `${readMinutes(a)} min de leitura`].filter(Boolean).join(' · '))}</div>
    <h1 class="reader-title">${esc(a.title)}</h1>
    <div class="quick">
      <a class="btn small" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">↗ Original</a>
      <button class="btn small" data-action="articleRead" data-id="${a.id}">${a.status === 'finished' ? '✓ Lido' : '✔ Marcar como lido'}</button>
      <button class="btn small" data-action="newNote" data-id="${a.id}">✍️ Nota</button>
      <button class="btn small ghost" data-action="deleteArticle" data-id="${a.id}">🗑️ Excluir</button>
    </div>
    ${articleTags(a)}
    <div class="reader-body" id="reader-body">${body || `<p class="nudge">Este artigo foi guardado só como link. Leia no <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">site original ↗</a> e registre aqui seus grifos com <b>✍️ Nota</b>, ou baixe o PDF de lá e use <a href="#" data-action="addPdf">📄 Adicionar PDF</a>.</p>`}</div>
  </article>
  <h3>Seus grifos (${notes.length})</h3>
  ${notes.length ? notes.map((n) => noteCard(n, false)).join('') : '<p class="small muted">Selecione um trecho do texto e toque em <b>Grifar</b>.</p>'}
  <div class="sel-bar" id="sel-bar" hidden><button class="btn primary" id="grifar-btn">🖍️ Grifar trecho</button><button class="btn" id="define-btn" hidden>📖 Significado</button></div>`;
}
// Seleção de texto + botão "Grifar" (artigos e PDFs). onSave recebe o texto e a página (no PDF).
export function attachGrifar(bodyEl, btn, onSave, { sourceId = null, refine = null } = {}) {
  // a barra tem o Grifar e, com uma palavra (ou expressão curta) selecionada, o Significado
  const bar = btn.closest('.sel-bar') || btn;
  const defineBtn = bar.querySelector('#define-btn');
  const shortSel = (t) => t && t.text.length <= 40 && t.text.split(' ').length <= 3;
  const isW = (ch) => /[\p{L}\p{N}]/u.test(ch || '');
  // trecho selecionado, completado até o fim das palavras cortadas pela seleção ("faz a m" → "faz a memória")
  const sel = () => {
    const s = getSelection();
    if (!s || s.isCollapsed || !bodyEl.contains(s.anchorNode) || !bodyEl.contains(s.focusNode)) return null;
    const r = s.getRangeAt(0).cloneRange();
    if (r.startContainer.nodeType === 3) {
      const t = r.startContainer.data;
      let i = r.startOffset;
      while (i > 0 && isW(t[i - 1]) && isW(t[i])) i--;
      r.setStart(r.startContainer, i);
    }
    if (r.endContainer.nodeType === 3) {
      const t = r.endContainer.data;
      let i = r.endOffset;
      while (i < t.length && isW(t[i - 1]) && isW(t[i])) i++;
      r.setEnd(r.endContainer, i);
    }
    const el = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    const block = el?.closest('p, li, blockquote, h1, h2, h3, h4, .pdf-page, figcaption, td') || el;
    // refine: no PDF em duas colunas, refaz o texto seguindo a coluna onde a seleção começou
    const text = (refine && refine(r)) || r.toString();
    return { text: text.replace(/\s+/g, ' ').trim(), page: Number(el?.closest('[data-page]')?.dataset.page) || null, around: block?.textContent || '' };
  };
  // guarda o último trecho selecionado: no toque, a seleção pode sumir antes do clique chegar ao botão
  let last = null;
  const onSel = () => {
    if (!btn.isConnected) { document.removeEventListener('selectionchange', onSel); return; }
    const t = sel();
    if (t && t.text.length >= 2) {
      last = t;
      bar.hidden = false;
      btn.hidden = t.text.length < 3;
      if (defineBtn) defineBtn.hidden = !shortSel(t);
    } else if (!bar.matches(':hover') && !bar.contains(document.activeElement)) bar.hidden = true;
  };
  document.addEventListener('selectionchange', onSel);
  // o mousedown nos botões não desfaz a seleção (cancelar o pointerdown impediria o clique no Chrome)
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  btn.onclick = async () => {
    const t = sel() || last;
    if (!t || t.text.length < 3) return;
    last = null;
    bar.hidden = true;
    getSelection().removeAllRanges();
    await onSave(t.text, t.page);
  };
  if (defineBtn) defineBtn.onclick = async () => {
    const t = sel() || last;
    if (!shortSel(t)) return;
    last = null;
    bar.hidden = true;
    getSelection().removeAllRanges();
    const D = await import('../dict.js');
    wordLookup(t.text, { sourceId, context: D.sentenceAround(t.around, D.cleanWord(t.text)) });
  };
}

// continua de onde parou e marca "Lendo" ao passar do começo
export function trackReading(id, bodyEl) {
  const saved = readPos(id);
  if (saved.y > 0 && view.dataset.route !== location.hash) setTimeout(() => scrollTo(0, saved.y), 50);
  let t = 0;
  const onScroll = () => {
    if (!bodyEl.isConnected) { removeEventListener('scroll', onScroll); return; }
    clearTimeout(t);
    t = setTimeout(async () => {
      const r = bodyEl.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / r.height));
      try { localStorage.setItem(POS_KEY(id), JSON.stringify({ p, y: scrollY })); } catch { /* sem armazenamento */ }
      const a = state.articles.find((x) => x.id === id);
      if (a && (a.status || 'want') === 'want' && p > 0.15) await persist('books', { ...a, status: 'reading', startDate: G.ymd() });
    }, 400);
  };
  addEventListener('scroll', onScroll, { passive: true });
}

articleView.mount = (id) => {
  const btn = $('#grifar-btn');
  const bodyEl = $('#reader-body');
  if (!btn || !bodyEl) return;
  trackReading(id, bodyEl);
  attachGrifar(bodyEl, btn, async (text) => {
    const note = { id: uid(), createdAt: Date.now(), bookId: id, text, kind: 'quote', source: 'article', tags: [], page: null };
    await commit(() => persist('notes', note));
    toast('🖍️ Trecho grifado · <u>adicionar reflexão</u>', '', () => noteForm(noteById(note.id)));
  }, { sourceId: id });
};
// ---------- PDFs ----------
// O arquivo fica no aparelho (IndexedDB); no Plus também vai para o armazenamento da conta e é baixado em outro aparelho.
export const canSyncPdf = () => Cloud.enabled() && Cloud.user() && Cloud.plan() === 'plus';
export async function pdfBlob(a) {
  const local = await db.getFile(a.id);
  if (local) return local;
  if (!canSyncPdf() || !a.synced) return null;
  const blob = await Cloud.downloadPdf(a.id);
  await db.setFile(a.id, blob);
  return blob;
}
export const pdfNotesHtml = (id) => {
  const notes = state.notes.filter((n) => n.bookId === id).sort((x, y) => (x.page || 0) - (y.page || 0) || x.createdAt - y.createdAt);
  return `<h3>Seus grifos (${notes.length})</h3>${notes.length ? notes.map((n) => noteCard(n, false)).join('') : '<p class="small muted">Selecione um trecho do PDF e toque em <b>Grifar</b>.</p>'}`;
};

export function pdfView(id) {
  const a = state.articles.find((x) => x.id === id && x.kind === 'pdf');
  if (!a) return `<a href="#/artigos" class="back">← Artigos</a>${empty('PDF não encontrado.')}`;
  return `<a href="#/artigos" class="back">← Artigos</a>
  <article class="reader pdf-reader">
    <div class="small muted">${esc(['PDF', a.pages ? `${a.pages} páginas` : '', a.author].filter(Boolean).join(' · '))}</div>
    <h1 class="reader-title">${esc(a.title)}</h1>
    <div class="quick">
      <button class="btn small" data-action="articleRead" data-id="${a.id}">${a.status === 'finished' ? '✓ Lido' : '✔ Marcar como lido'}</button>
      <button class="btn small" data-action="newNote" data-id="${a.id}">✍️ Nota</button>
      <button class="btn small" data-action="pdfImport" data-id="${a.id}">📥 Importar grifos do arquivo</button>
      <button class="btn small ghost" data-action="deleteArticle" data-id="${a.id}">🗑️ Excluir</button>
    </div>
    ${articleTags(a)}
    <p class="small muted" id="pdf-status">Abrindo o PDF…</p>
    <div class="pdf-pages" id="reader-body"></div>
  </article>
  <div id="pdf-notes">${pdfNotesHtml(id)}</div>
  <div class="sel-bar" id="sel-bar" hidden><button class="btn primary" id="grifar-btn">🖍️ Grifar trecho</button><button class="btn" id="define-btn" hidden>📖 Significado</button></div>`;
}
pdfView.mount = async (id) => {
  const a = state.articles.find((x) => x.id === id && x.kind === 'pdf');
  const bodyEl = $('#reader-body');
  const status = $('#pdf-status');
  if (!a || !bodyEl) return;
  let blob;
  try { blob = await pdfBlob(a); } catch { blob = null; }
  if (!bodyEl.isConnected) return;
  if (!blob) {
    status.innerHTML = `O arquivo deste PDF está em outro aparelho${canSyncPdf() ? '' : ' (no Plus, seus PDFs sincronizam entre aparelhos)'}. <button class="btn small" id="pdf-reattach">📄 Escolher o arquivo</button>`;
    $('#pdf-reattach').onclick = () => actions.addPdf({ id });
    return;
  }
  const P = await import('../pdf.js');
  let doc;
  try { doc = await P.openPdf(blob); } catch (e) { status.textContent = `Não consegui abrir o PDF: ${e.message}`; return; }
  status.remove();
  // páginas: espaço reservado do tamanho certo e desenho só quando chega perto da tela
  const width = Math.min(bodyEl.clientWidth || 600, 900);
  const first = await doc.getPage(1);
  const v = first.getViewport({ scale: 1 });
  const h = Math.round((width / v.width) * v.height);
  bodyEl.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<div class="pdf-page" data-page="${i + 1}" style="width:${width}px;height:${h}px"><span class="pdf-pn">${i + 1}</span></div>`).join('');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || e.target.dataset.done) continue;
      e.target.dataset.done = '1';
      P.renderPage(doc, Number(e.target.dataset.page), e.target, width).catch(() => { e.target.dataset.done = ''; });
    }
  }, { rootMargin: '900px 0px' });
  bodyEl.querySelectorAll('.pdf-page').forEach((el) => io.observe(el));
  trackReading(id, bodyEl);
  attachGrifar(bodyEl, $('#grifar-btn'), async (text, page) => {
    const note = { id: uid(), createdAt: Date.now(), bookId: id, text, kind: 'quote', source: 'pdf', tags: [], page };
    await commit(() => persist('notes', note), { rerender: false });
    $('#pdf-notes').innerHTML = pdfNotesHtml(id);
    toast(`🖍️ Grifado${page ? ` (p. ${page})` : ''} · <u>adicionar reflexão</u>`, '', () => noteForm(noteById(note.id)));
  }, { sourceId: id, refine: P.columnText });
  // na primeira vez, traz os grifos que já estavam no arquivo
  if (!a.imported) importPdfHighlights(a, doc, P, true);
};

// Grifos feitos em outros apps viram notas (sem repetir os que já existem)
export async function importPdfHighlights(a, doc, P, auto = false) {
  try {
    const found = await P.existingHighlights(doc);
    const have = new Set(state.notes.filter((n) => n.bookId === a.id).map((n) => `${n.page}|${norm(plainText(n.text))}`));
    const add = found.filter((x) => !have.has(`${x.page}|${norm(x.text)}`));
    await commit(async () => {
      for (const [i, x] of add.entries()) {
        await persist('notes', { id: uid(), createdAt: Date.now() + i, bookId: a.id, text: x.comment ? `${x.text}\n\n${x.comment}` : x.text, kind: 'quote', source: 'pdf', tags: [], page: x.page });
      }
      await persist('books', { ...state.articles.find((y) => y.id === a.id), imported: true });
    }, { rerender: false });
    if ($('#pdf-notes')) $('#pdf-notes').innerHTML = pdfNotesHtml(a.id);
    if (add.length) toast(`📥 ${add.length} ${add.length === 1 ? 'grifo importado' : 'grifos importados'} do arquivo`);
    else if (!auto) toast(found.length ? 'Os grifos do arquivo já estavam aqui.' : 'Este PDF não tem grifos feitos em outros apps.');
  } catch (e) {
    if (!auto) toast(`Não consegui ler os grifos do arquivo: ${esc(e.message)}`, 'err');
  }
}

export const pdfActions = {
  // escolhe um PDF no aparelho (id: trocar o arquivo de um PDF já salvo)
  addPdf({ id } = {}) {
    const input = $('#pdf-file') || Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf' });
    input.value = '';
    input.onchange = () => { if (input.files[0]) importPdfFile(input.files[0], id); };
    input.click();
  },
  // PDF recebido pelo "Compartilhar" do celular: o service worker guardou num cache até o app abrir
  async sharedPdf() {
    let c, res;
    try { c = await caches.open(SHARE_CACHE); res = await c.match('pdf'); } catch { /* sem cache */ }
    if (!res) return;
    await c.delete('pdf');
    const name = decodeURIComponent(res.headers.get('x-name') || 'documento.pdf');
    importPdfFile(new File([await res.blob()], name, { type: 'application/pdf' }));
  },
  async pdfImport({ id }) {
    const a = state.articles.find((x) => x.id === id);
    const blob = await pdfBlob(a);
    if (!blob) { toast('O arquivo deste PDF não está neste aparelho.', 'err'); return; }
    const P = await import('../pdf.js');
    importPdfHighlights(a, await P.openPdf(blob), P, false);
  },
};

// Abre um PDF escolhido (ou recebido pelo "Compartilhar") e guarda no aparelho (e na conta, no Plus).
// id: trocar o arquivo de um PDF já salvo
export const SHARE_CACHE = 'grifo-compartilhado';
export async function importPdfFile(f, id) {
  if (f.size > 50 * 1024 * 1024) { toast('PDF grande demais (máximo 50 MB).', 'err'); return; }
  toast('📄 Abrindo o PDF…');
  try {
    const P = await import('../pdf.js');
    const doc = await P.openPdf(f);
    const meta = await P.info(doc, f.name);
    const old = id && state.articles.find((x) => x.id === id);
    const rec = old ? { ...old, pages: meta.pages } : {
      id: uid(), createdAt: Date.now(), kind: 'pdf', status: 'reading', startDate: G.ymd(), purpose: 'hobby', genre: '', subtheme: '', pages: meta.pages, currentPage: 0, rating: 0, isbn: '',
      title: meta.title || 'PDF sem título', author: meta.author, fileName: f.name, size: f.size,
    };
    await db.setFile(rec.id, f);
    if (canSyncPdf()) {
      // sem esperar mais que 30 s: a conexão lenta não pode impedir de abrir o PDF
      const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 30_000));
      try { await Promise.race([Cloud.uploadPdf(rec.id, f), slow]); rec.synced = true; } catch { toast('O PDF ficou só neste aparelho (não foi possível enviar para a conta agora).', 'err'); }
    }
    await commit(() => persist('books', rec));
    Cloud.track('pdf_add');
    location.hash = `#/pdf/${rec.id}`;
    if (!old) toast(`📄 “${esc(rec.title)}” adicionado · <u>mudar o nome</u>`, '', () => actions.classifyArticle({ id: rec.id }));
    if (old) render();
  } catch (e) {
    console.error(e);
    const why = e?.name === 'PasswordException' ? 'o arquivo tem senha' : e?.name === 'InvalidPDFException' ? 'o arquivo não é um PDF válido' : e?.message || String(e);
    toast(`Não consegui abrir esse PDF: ${esc(why)}`, 'err');
  }
}

// Sugestão de finalidade, tema e subtema pela IA (Plus), usando os temas que a pessoa já tem
export async function suggestCategory(a) {
  const map = new Map();
  for (const b of sources()) {
    if (!b.genre) continue;
    if (!map.has(b.genre)) map.set(b.genre, new Set());
    if (b.subtheme) map.get(b.genre).add(b.subtheme);
  }
  const themes = [...map].map(([theme, subs]) => ({ theme, subthemes: [...subs] }));
  const text = (a.blocks || []).map((b) => b.x).join('\n').slice(0, 5000);
  return aiRun('classify', { title: a.title, site: a.site, text, themes });
}
// Logo depois de salvar: classifica sozinho, se a IA estiver liberada para a pessoa
export async function autoClassify(id) {
  if (AI.available(state.settings) !== 'ok') return;
  try {
    const a = state.articles.find((x) => x.id === id);
    const r = await suggestCategory(a);
    const now = state.articles.find((x) => x.id === id);
    if (!now || now.genre) return; // a pessoa já classificou nesse meio tempo
    await commit(() => persist('books', { ...now, purpose: r.purpose, genre: r.theme, subtheme: r.subtheme }), { quiet: true });
    toast(`🏷️ Classificado como ${esc(r.theme)} › ${esc(r.subtheme)} · <u>alterar</u>`, '', () => actions.classifyArticle({ id }));
  } catch { /* sem classificação automática: a pessoa classifica à mão */ }
}

export const articleActions = {
  async saveArticle({ url }) {
    if (!/^https?:\/\//i.test(url || '')) { toast('Cole o endereço completo do artigo, começando com https://', 'err'); return; }
    const same = state.articles.find((a) => a.url === url || a.sourceUrl === url);
    if (same) { location.hash = `#/artigo/${same.id}`; return; }
    if (!Cloud.enabled() || !Cloud.user()) { toast('Entre na sua conta para salvar artigos.', 'err'); return; }
    if (!isPlus() && state.articles.length >= FREE_ARTICLES) {
      toast(`⭐ O plano grátis guarda até ${FREE_ARTICLES} artigos · <u>conhecer o Plus</u>`, 'gold', () => { location.hash = '#/plus'; });
      return;
    }
    const btn = $('#art-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
    toast('📰 Buscando o artigo…');
    try {
      const r = await Cloud.fetchArticle(url);
      const art = {
        id: uid(), createdAt: Date.now(), kind: 'article', status: 'want', purpose: 'hobby', genre: '', subtheme: '', pages: 0, currentPage: 0, rating: 0, isbn: '',
        title: r.title, author: r.byline, site: r.site, url: r.url, sourceUrl: url, cover: r.image, excerpt: r.excerpt, published: r.published, lang: r.lang, blocks: r.blocks,
      };
      await commit(() => persist('books', art));
      Cloud.track('article_save');
      location.hash = `#/artigo/${art.id}`;
      toast(`📰 “${esc(art.title)}” salvo · <u>mudar o nome</u>`, '', () => actions.classifyArticle({ id: art.id }));
      autoClassify(art.id);
    } catch (e) {
      articleFallback(url, e.message);
    } finally {
      if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'Salvar'; }
    }
  },
  classifyArticle({ id }) {
    const a = state.articles.find((x) => x.id === id);
    openModal(`<form class="form" id="artcat-form"><h3>✏️ ${a.kind === 'pdf' ? 'Editar PDF' : 'Editar artigo'}</h3>
      <label>Nome <input name="title" required value="${esc(a.title)}" autocomplete="off"></label>
      <label>Autor <input name="author" value="${esc(a.author || '')}" placeholder="ex: Silva, M.; Souza, A." autocomplete="off"></label>
      <label>Finalidade
        <div class="radio-pills">${Object.entries(PURPOSE).map(([k, p]) => `<input type="radio" name="purpose" id="ap-${k}" value="${k}" ${(a.purpose || 'hobby') === k ? 'checked' : ''}><label for="ap-${k}">${p.icon} ${p.label}</label>`).join('')}</div>
      </label>
      <div class="grid2">
        <label>Tema <input name="genre" list="themes" value="${esc(a.genre || '')}" placeholder="ex: Psicologia" autocomplete="off">${datalist('themes', themeOptions())}</label>
        <label>Subtema <input name="subtheme" list="subthemes" value="${esc(a.subtheme || '')}" placeholder="ex: Memória" autocomplete="off"><span id="art-subthemes">${datalist('subthemes', subthemeOptions(a.genre))}</span></label>
      </div>
      <button type="button" class="btn small" id="artcat-ai">✨ Sugerir com IA${isPlus() ? '' : ' 🔒'}</button>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`, (root) => {
      const form = $('#artcat-form', root);
      $('#artcat-ai', root).onclick = async (e) => {
        if (!isPlus()) { closeModal(); toast('⭐ A classificação com IA faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; }); return; }
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = '✨ Pensando…';
        try {
          const r = await suggestCategory(a);
          root.querySelector(`#ap-${r.purpose}`).checked = true;
          form.genre.value = r.theme;
          form.subtheme.value = r.subtheme;
        } catch (err) { if (err.message) toast(esc(err.message), 'err'); }
        b.disabled = false;
        b.textContent = '✨ Sugerir com IA';
      };
      form.genre.oninput = () => { $('#art-subthemes', root).innerHTML = datalist('subthemes', subthemeOptions(form.genre.value)); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form));
        closeModal();
        const title = fd.title.trim() || a.title;
        await commit(async () => {
          await persist('books', { ...a, title, author: fd.author.trim(), purpose: fd.purpose || 'hobby', genre: fd.genre.trim(), subtheme: fd.subtheme.trim() });
          // as notas que citavam o nome antigo com [[ ]] passam a citar o novo
          if (title !== a.title) {
            const old = norm(a.title);
            for (const n of state.notes) {
              const text = n.text.replace(LINK_RE, (m, x) => {
                const [t, alias] = x.split('|');
                return norm(t) === old ? `[[${title}${alias !== undefined ? `|${alias}` : ''}]]` : m;
              });
              if (text !== n.text) await persist('notes', { ...n, text });
            }
          }
        });
      };
    });
  },
  async hideFirstSteps() {
    state.settings = { ...state.settings, firstStepsHidden: true };
    await db.setKV('settings', state.settings);
    render();
  },
  artFilter: ({ v }) => { sessionStorage.setItem('artFilter', v); render(); },
  async articleRead({ id }) {
    const a = state.articles.find((x) => x.id === id);
    await commit(() => persist('books', { ...a, status: a.status === 'finished' ? 'want' : 'finished', endDate: a.status === 'finished' ? '' : G.ymd() }));
  },
  async deleteArticle({ id }) {
    const a = state.articles.find((x) => x.id === id);
    const notes = state.notes.filter((n) => n.bookId === id);
    if (!confirm(`Excluir “${a.title}”${notes.length ? ` e ${notes.length} grifo(s)` : ''}?`)) return;
    await commit(async () => {
      for (const c of state.cards.filter((x) => notes.some((n) => n.id === x.noteId))) await remove('cards', c.id);
      for (const n of notes) await remove('notes', n.id);
      await remove('books', id);
    });
    toast(`🗑️ “${esc(a.title)}” excluído`);
    if (a.kind === 'pdf') {
      await db.delFile(id);
      if (a.synced && canSyncPdf()) Cloud.deletePdf(id).catch(() => {});
    }
    location.hash = '#/artigos';
  },
};

// Link recebido pelo menu "Compartilhar" do celular (manifest share_target): guarda e salva quando der
(function captureShared() {
  const q = new URLSearchParams(location.search);
  const found = [q.get('url'), q.get('text'), q.get('title')].join(' ').match(/https?:\/\/[^\s"<>]+/);
  if (!found) return;
  try { localStorage.setItem(SHARED_KEY, found[0]); } catch { /* sem armazenamento */ }
  for (const k of ['url', 'text', 'title']) q.delete(k);
  history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + '#/artigos');
})();
export function saveSharedArticle() {
  let url = null;
  try { url = localStorage.getItem(SHARED_KEY); } catch { /* sem armazenamento */ }
  if (!url || !Cloud.user()) return;
  try { localStorage.removeItem(SHARED_KEY); } catch { /* sem armazenamento */ }
  setTimeout(() => actions.saveArticle({ url }), 0);
}
