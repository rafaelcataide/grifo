// Referências bibliográficas (ABNT NBR 6023:2018 e APA 7ª ed.) e citações com página,
// a partir dos dados do livro, artigo ou PDF. Funções puras: devolvem { html, text }
// (html com o título em negrito/itálico, como as normas pedem; text para colar sem formatação).

const MESES_ABNT = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const MESES_APA = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// "2024-03-15" é a data do dia (sem fuso): lida como data local, para não virar dia 14
const dataDe = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : s ? new Date(s) : null;
  return d && !Number.isNaN(+d) ? d : null;
};
// "SILVA FILHO" → "Silva Filho" (a APA não usa sobrenome em maiúsculas)
const titleCase = (s) => (s === s.toLocaleUpperCase('pt-BR') ? s.toLocaleLowerCase('pt-BR').replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toLocaleUpperCase('pt-BR')) : s);
// partes do sobrenome que vão junto ("SILVA FILHO", "MARTIN JR.")
const SUFIXOS = /^(filho|filha|neto|neta|sobrinho|júnior|junior|jr\.?|segundo)$/i;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Autores separados: "Daniel Kahneman, Amos Tversky", "KAHNEMAN, Daniel", "A; B", "A & B" ou "A e B".
 * @returns {{ surname: string, given: string }[]}
 */
export function parseAuthors(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  let parts = s.split(/\s*(?:;|&|\se\s|\sand\s)\s*/i).filter(Boolean);
  // "Sobrenome, Nome" (uma vírgula, primeira parte sem espaço) é um autor só; senão a vírgula separa autores
  if (parts.length === 1) {
    const c = s.split(/\s*,\s*/);
    // uma vírgula só: "KAHNEMAN, Daniel", "SILVA FILHO, João" (sobrenome de uma palavra, em maiúsculas, ou nome de uma palavra)
    const sobrenomeNome = c.length === 2 && (!/\s/.test(c[0]) || c[0] === upper(c[0]) || !/\s/.test(c[1]));
    parts = sobrenomeNome ? [s] : c;
  }
  return parts.map((p) => {
    if (p.includes(',')) {
      const [surname, given = ''] = p.split(/\s*,\s*/);
      return { surname: surname.trim(), given: given.trim() };
    }
    const w = p.trim().split(/\s+/);
    if (w.length === 1) return { surname: w[0], given: '' };
    const n = w.length > 2 && SUFIXOS.test(w.at(-1)) ? 2 : 1;
    return { surname: w.slice(-n).join(' '), given: w.slice(0, -n).join(' ') };
  }).filter((a) => a.surname);
}

const upper = (s) => s.toLocaleUpperCase('pt-BR');
const initials = (given) => given.split(/[\s-]+/).filter((x) => x && !/^(de|da|do|dos|das|e)$/i.test(x)).map((x) => `${x[0].toUpperCase()}.`).join(' ');
const yearOf = (x) => (String(x || '').match(/\d{4}/) || [''])[0];
const splitTitle = (t) => { const i = String(t || '').indexOf(': '); return i > 0 ? [t.slice(0, i), t.slice(i + 2)] : [String(t || ''), '']; };
// fecha a autoria com ponto, sem dobrar quando já termina em ponto ("J.", "et al.")
const ponto = (s) => (s.endsWith('.') ? s : `${s}.`);
const dataAbnt = (d) => `${d.getDate()} ${MESES_ABNT[d.getMonth()]} ${d.getFullYear()}`;

function abntAutores(list) {
  if (!list.length) return '';
  const um = (a) => (a.given ? `${upper(a.surname)}, ${a.given}` : upper(a.surname));
  return list.length > 3 ? `${um(list[0])} et al.` : list.map(um).join('; ');
}
function apaAutores(list) {
  const um = (a) => (a.given ? `${titleCase(a.surname)}, ${initials(a.given)}` : titleCase(a.surname));
  if (!list.length) return '';
  if (list.length === 1) return um(list[0]);
  if (list.length === 2) return `${um(list[0])}, & ${um(list[1])}`;
  const n = list.slice(0, 19).map(um);
  return `${n.slice(0, -1).join(', ')}, & ${n.at(-1)}`;
}
// sem autor, a ABNT entra pelo título, com a primeira palavra em maiúsculas
// (com artigo no começo, a palavra seguinte também: "O LIVRO sem autor")
const abntPeloTitulo = (t) => String(t).replace(/^((?:o|a|os|as|um|uma|uns|umas|the|a|an)\s+)?(\S+)/i, (w) => upper(w));
const isOnline = (b) => b.kind === 'article';

/**
 * Referência na norma escolhida.
 * @param {object} b livro, artigo (kind 'article') ou PDF (kind 'pdf'), com publisher, year, city, edition quando houver
 * @param {'abnt'|'apa'} style
 * @param {Date} [today] data de acesso (artigos da internet)
 */
export function reference(b, style = 'abnt', today = new Date()) {
  const autores = parseAuthors(b.author);
  const [titulo, sub] = splitTitle(b.title);
  const ano = yearOf(b.year || b.published);
  const ed = String(b.edition || '').replace(/\D/g, '');
  if (style === 'apa') {
    const quem = apaAutores(autores);
    if (isOnline(b)) {
      const d = dataDe(b.published);
      const quando = d ? `${d.getFullYear()}, ${d.getDate()} de ${MESES_APA[d.getMonth()]}` : (ano || 's.d.');
      const head = quem ? `${quem} (${quando}). ${b.title}.` : `${b.title}. (${quando}).`;
      return {
        html: `${esc(head)} <i>${esc(b.site || '')}</i>. ${esc(b.url || '')}`.replace(/ <i><\/i>\. /, ' '),
        text: `${head} ${b.site ? `${b.site}. ` : ''}${b.url || ''}`.trim(),
      };
    }
    const edicao = ed && ed !== '1' ? ` (${ed}ª ed.)` : '';
    const fim = [b.publisher].filter(Boolean).join('');
    const head = quem ? `${quem} (${ano || 's.d.'}). ` : '';
    const tail = `${edicao}.${fim ? ` ${fim}.` : ''}${quem ? '' : ` (${ano || 's.d.'}).`}`;
    return { html: `${esc(head)}<i>${esc(b.title)}</i>${esc(tail)}`, text: `${head}${b.title}${tail}` };
  }
  // ABNT
  const quem = abntAutores(autores);
  if (isOnline(b)) {
    const d = dataDe(b.published);
    const quando = d ? dataAbnt(d) : ano;
    const inicio = quem ? `${ponto(quem)} ${b.title}.` : `${abntPeloTitulo(b.title)}.`;
    const fim = `${quando ? `, ${quando}` : ''}. Disponível em: ${b.url || ''}. Acesso em: ${dataAbnt(today)}.`;
    return { html: `${esc(inicio)} <b>${esc(b.site || '[s. l.]')}</b>${esc(fim)}`, text: `${inicio} ${b.site || '[s. l.]'}${fim}` };
  }
  const edicao = ed && ed !== '1' ? ` ${ed}. ed.` : '';
  const imprenta = ` ${b.city || '[S. l.]'}: ${b.publisher || '[s. n.]'}, ${ano || '[s. d.]'}.`;
  if (!quem) {
    // sem autor: a primeira palavra do título em maiúsculas, sem negrito
    const t = `${abntPeloTitulo(b.title)}.${edicao}${imprenta}`;
    return { html: esc(t), text: t };
  }
  return {
    html: `${esc(ponto(quem))} <b>${esc(titulo)}</b>${sub ? `: ${esc(sub)}` : ''}.${esc(edicao + imprenta)}`,
    text: `${ponto(quem)} ${titulo}${sub ? `: ${sub}` : ''}.${edicao}${imprenta}`,
  };
}

/** Citação no texto: (KAHNEMAN, 2012, p. 21) na ABNT; (Kahneman, 2012, p. 21) na APA. */
export function citation(b, page, style = 'abnt') {
  const autores = parseAuthors(b.author);
  const ano = yearOf(b.year || b.published) || (style === 'apa' ? 's.d.' : 's. d.');
  const pag = page ? `, p. ${page}` : '';
  if (!autores.length) {
    // sem autor, a ABNT cita pela entrada do título (a primeira palavra, ou o artigo e a seguinte)
    const w = (abntPeloTitulo(b.title || '').match(/^(?:\p{Lu}+\s+)?\p{Lu}[\p{Lu}\d]*/u) || [''])[0];
    return style === 'apa' ? `(${b.title}, ${ano}${pag})` : `(${w}..., ${ano}${pag})`;
  }
  if (style === 'apa') {
    const s = autores.map((a) => titleCase(a.surname));
    const quem = s.length === 1 ? s[0] : s.length === 2 ? `${s[0]} & ${s[1]}` : `${s[0]} et al.`;
    return `(${quem}, ${ano}${pag})`;
  }
  const s = autores.map((a) => upper(a.surname));
  const quem = s.length > 3 ? `${s[0]} et al.` : s.join('; ');
  return `(${quem}, ${ano}${pag})`;
}

/** O que falta para a referência ficar completa (para pedir à pessoa). */
export function missingFields(b) {
  if (isOnline(b)) return [!b.author && 'author'].filter(Boolean);
  return [!b.author && 'author', !b.publisher && 'publisher', !b.city && 'city', !yearOf(b.year) && 'year'].filter(Boolean);
}

/** Lista de referências em ordem alfabética (ABNT e APA ordenam pela entrada). */
export function bibliography(items, style = 'abnt', today = new Date()) {
  return items.map((b) => reference(b, style, today))
    .sort((x, y) => x.text.localeCompare(y.text, 'pt-BR', { sensitivity: 'base' }));
}
