// Referências ABNT e APA (plano Pro): janela da referência de um livro, artigo ou PDF, a citação
// de um grifo com a página, e a lista de referências da estante. As regras estão em ../referencias.js.
import { esc, plainText } from '../util.js';
import { tr } from '../i18n.js';
import * as Cloud from '../cloud.js';
import { reference, citation, missingFields, bibliography } from '../referencias.js';
import { openModal, closeModal, persist, commit, toast, bookById, noteById, sources } from '../app.js';

// Pro (e o modo pessoal, que tem tudo liberado)
export const isPro = () => ['pro', 'personal'].includes(Cloud.plan());

const STYLE_KEY = 'grifo.refStyle';
const getStyle = () => { try { return localStorage.getItem(STYLE_KEY) === 'apa' ? 'apa' : 'abnt'; } catch { return 'abnt'; } };
const setStyle = (s) => { try { localStorage.setItem(STYLE_KEY, s); } catch { /* sem armazenamento */ } };

// copia com formatação (negrito/itálico vão junto para o Word e o Google Docs) e em texto simples
async function copyRich(html, text) {
  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text);
    toast('📋 Copiado');
  } catch {
    prompt(tr('Copie:'), text);
  }
}

const FIELD_LABEL = { author: 'Autor', publisher: 'Editora', city: 'Cidade', year: 'Ano', edition: 'Edição' };
const styleSwitch = (style) => `<div class="seg-mini" role="group" aria-label="Norma">
  <button type="button" class="${style === 'abnt' ? 'active' : ''}" data-ref-style="abnt">ABNT</button><button type="button" class="${style === 'apa' ? 'active' : ''}" data-ref-style="apa">APA</button></div>`;
const lockedNote = '<p class="small ref-lock">⭐ Referências e citações prontas fazem parte do <b>Grifo Pro</b> · <a href="#/plus" data-ref-plans>ver planos</a></p>';

/**
 * Janela da referência. src: livro, artigo ou PDF; note: grifo a citar (com a página), opcional.
 */
export function refModal(src, note = null) {
  if (!src) return;
  const pro = isPro();
  const style = getStyle();
  const ref = reference(src, style);
  const quote = note ? plainText(note.text).trim() : '';
  const cit = note ? citation(src, note.page, style) : '';
  const missing = missingFields(src);
  const online = src.kind === 'article';
  const fields = online ? ['author'] : ['author', 'publisher', 'city', 'year', 'edition'];
  openModal(`<div class="form ref-modal">
    <div class="row between gap-s wrap"><h3 style="margin:0">📚 ${note ? 'Citar este grifo' : 'Referência'}</h3>${styleSwitch(style)}</div>
    ${note ? `<div class="small muted">${tr('Citação no texto')}</div>
      <div class="ref-box${pro ? '' : ' locked'}">“${esc(quote.length > 400 ? `${quote.slice(0, 399)}…` : quote)}” ${esc(cit)}</div>
      ${pro ? '<button type="button" class="btn small" data-copy="cit">📋 Copiar citação</button>' : ''}` : ''}
    <div class="small muted">${tr('Referência')} ${style === 'abnt' ? '(ABNT NBR 6023)' : '(APA 7)'}</div>
    <div class="ref-box${pro ? '' : ' locked'}">${ref.html}</div>
    ${pro ? '<button type="button" class="btn small primary" data-copy="ref">📋 Copiar referência</button>' : lockedNote}
    ${missing.length ? `<p class="small ref-missing">⚠️ ${tr('Faltam dados para a referência ficar completa:')} <b>${missing.map((k) => tr(FIELD_LABEL[k])).join(', ')}</b>.</p>` : ''}
    <details${missing.length ? ' open' : ''}><summary class="small">${tr('Dados da obra')}</summary>
      <form class="grid2" id="ref-form" style="margin-top:8px">${fields.map((k) => `<label>${FIELD_LABEL[k]} <input name="${k}" value="${esc(src[k] || '')}" placeholder="${k === 'author' ? 'ex: Daniel Kahneman' : k === 'publisher' ? 'ex: Objetiva' : k === 'city' ? 'ex: Rio de Janeiro' : k === 'year' ? 'ex: 2012' : 'ex: 2'}" ${k === 'year' || k === 'edition' ? 'inputmode="numeric"' : ''} autocomplete="off"></label>`).join('')}
        <div class="actions" style="grid-column:1/-1"><button class="btn small">Salvar dados</button></div></form>
    </details>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Fechar</button></div>
  </div>`, (root) => {
    root.querySelectorAll('[data-ref-style]').forEach((b) => { b.onclick = () => { setStyle(b.dataset.refStyle); refModal(src, note); }; });
    root.querySelector('[data-ref-plans]')?.addEventListener('click', () => closeModal());
    root.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = () => (b.dataset.copy === 'ref'
        ? copyRich(ref.html, ref.text)
        : copyRich(`“${esc(quote)}” ${esc(cit)}`, `“${quote}” ${cit}`));
    });
    const form = root.querySelector('#ref-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const upd = { ...src };
      for (const k of fields) upd[k] = String(fd[k] || '').trim();
      await commit(() => persist('books', upd), { rerender: false });
      toast('✔ Dados salvos');
      refModal(upd, note); // mostra a referência já completa
    };
  });
}

/** Lista de referências da estante inteira (livros lidos/lendo, artigos e PDFs), em ordem alfabética. */
export function bibliographyModal() {
  const pro = isPro();
  const style = getStyle();
  const items = sources().filter((b) => b.title && (b.kind === 'article' || b.kind === 'pdf' || b.status !== 'want'));
  const list = bibliography(items, style);
  const html = list.map((r) => `<p>${r.html}</p>`).join('');
  const text = list.map((r) => r.text).join('\n\n');
  const incompletos = items.filter((b) => missingFields(b).length).length;
  openModal(`<div class="form ref-modal">
    <div class="row between gap-s wrap"><h3 style="margin:0">📚 Lista de referências</h3>${styleSwitch(style)}</div>
    <p class="small muted" style="margin:0">${items.length} ${tr('obras (livros que você leu ou está lendo, artigos e PDFs), em ordem alfabética.')}</p>
    ${incompletos ? `<p class="small ref-missing">⚠️ ${incompletos} ${tr('com dados faltando: abra a obra e toque em 📚 Referência para completar.')}</p>` : ''}
    <div class="ref-box ref-list${pro ? '' : ' locked'}">${html || '<p class="muted">Nada ainda.</p>'}</div>
    ${pro ? '<button type="button" class="btn primary" data-copy-all>📋 Copiar a lista</button>' : lockedNote}
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Fechar</button></div>
  </div>`, (root) => {
    root.querySelectorAll('[data-ref-style]').forEach((b) => { b.onclick = () => { setStyle(b.dataset.refStyle); bibliographyModal(); }; });
    root.querySelector('[data-ref-plans]')?.addEventListener('click', () => closeModal());
    const all = root.querySelector('[data-copy-all]');
    if (all) all.onclick = () => copyRich(html, text);
  });
}

export const refActions = {
  reference: ({ id }) => refModal(bookById(id)),
  citeNote: ({ id }) => { const n = noteById(id); refModal(bookById(n?.bookId), n); },
  bibliography: () => bibliographyModal(),
};
