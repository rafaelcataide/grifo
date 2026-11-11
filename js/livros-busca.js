// Busca de livros: transforma a resposta de cada base (BrasilAPI, Google Livros, Open Library) num
// formato só, junta o mesmo livro vindo de bases diferentes e ordena o resultado.
// Sem tela e sem rede (quem busca é o app): testável com node --test.
import { norm } from './util.js';

const digits = (s) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase();

/** ISBN-13 a partir de um ISBN-10 ou 13 (com ou sem hífens); '' se não for um ISBN. */
export function isbn13(raw) {
  const d = digits(raw);
  if (/^\d{13}$/.test(d)) return d;
  if (!/^\d{9}[\dX]$/.test(d)) return '';
  const base = `978${d.slice(0, 9)}`;
  const sum = [...base].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

const year = (s) => (/\d{4}/.exec(String(s || '')) || [''])[0];
const https = (u) => String(u || '').replace(/^http:\/\//, 'https://');

/** BrasilAPI (CBL, Mercado Editorial…): uma obra por ISBN. */
export function fromBrasilApi(v, isbn = '') {
  if (!v?.title) return [];
  return [{
    title: [v.title, v.subtitle].filter(Boolean).join(': '), author: (v.authors || []).join(', '),
    pages: v.page_count || '', category: (v.subjects || [])[0] || '', isbn: isbn13(v.isbn || isbn) || digits(v.isbn || isbn), cover: https(v.cover_url),
    publisher: v.publisher || '', year: year(v.year), city: v.location || '', edition: v.edition || '', lang: 'pt', src: 'brasilapi',
  }];
}

/** Google Livros. */
export function fromGoogle(g) {
  return (g?.items || []).map(({ volumeInfo: v = {} }) => {
    const ids = v.industryIdentifiers || [];
    const id = (ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10') || {}).identifier || '';
    return {
      title: [v.title, v.subtitle].filter(Boolean).join(': '), author: (v.authors || []).join(', '),
      pages: v.pageCount || '', category: (v.categories || [])[0] || '', isbn: isbn13(id), cover: https(v.imageLinks?.thumbnail),
      publisher: v.publisher || '', year: year(v.publishedDate), city: '', edition: '', lang: String(v.language || '').slice(0, 2).toLowerCase(), src: 'google',
    };
  }).filter((b) => b.title);
}

/** Open Library. */
export function fromOpenLibrary(o) {
  return (o?.docs || []).map((d) => {
    const langs = d.language || [];
    return {
      title: d.title || '', author: (d.author_name || []).join(', '), pages: d.number_of_pages_median || '', category: '',
      isbn: isbn13((d.isbn || []).find((x) => digits(x).length === 13) || (d.isbn || [])[0]),
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
      publisher: (d.publisher || [])[0] || '', year: year(d.first_publish_year), city: '', edition: '',
      // a Open Library lista todos os idiomas das edições: só vale como "português" se for o único
      lang: langs.length === 1 ? ({ por: 'pt', eng: 'en', spa: 'es' }[langs[0]] || '') : '', src: 'openlibrary',
    };
  }).filter((b) => b.title);
}

const FIELDS = ['title', 'author', 'pages', 'category', 'isbn', 'cover', 'publisher', 'year', 'city', 'edition', 'lang'];
// mesma obra sem ISBN em comum: título principal (antes do subtítulo) + sobrenome do primeiro autor
const titleKey = (b) => `${norm(String(b.title).split(/[:(–—]| - /)[0]).trim()}|${norm(String(b.author).split(',')[0]).trim().split(' ').pop()}`;

/**
 * Junta as listas das bases (na ordem de confiança: a primeira lista ganha quando as duas têm o campo).
 * Mesmo ISBN = mesmo livro: os campos vazios de um são completados pelo outro (capa de uma base,
 * editora e cidade de outra). Sem ISBN de um dos lados, vale título + autor.
 * sameBook: busca por ISBN, em que tudo o que voltou é o mesmo livro.
 */
export function mergeBooks(lists, { sameBook = false } = {}) {
  const out = [];
  for (const list of lists) {
    for (const b of list || []) {
      const hit = out.find((x) => sameBook
        || (b.isbn && x.isbn ? b.isbn === x.isbn : titleKey(b) === titleKey(x) && titleKey(b).length > 3));
      if (!hit) { out.push({ ...b, srcs: [b.src] }); continue; }
      for (const k of FIELDS) if (!hit[k] && b[k]) hit[k] = b[k];
      if (!hit.srcs.includes(b.src)) hit.srcs.push(b.src);
    }
  }
  return out;
}

const words = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/**
 * Quanto um resultado bate com o que a pessoa digitou (0 a 20): todas as palavras no título ou no autor,
 * título igual ao digitado, título que começa com o digitado. É o que mais pesa na ordem.
 */
export function relevance(b, query) {
  const q = words(query);
  if (!q.length) return 0;
  const main = words(String(b.title).split(/[:(–—]| - /)[0]).join(' ');
  const title = words(b.title), author = words(b.author);
  const inTitle = q.filter((w) => title.includes(w)).length, inAny = q.filter((w) => title.includes(w) || author.includes(w)).length;
  let s = (inAny / q.length) * 8;
  if (inAny === q.length) s += 2;
  if (inTitle === q.length) s += 3;
  if (main === q.join(' ')) s += 7; // o título é exatamente o que foi digitado
  else if (title.join(' ').startsWith(q.join(' '))) s += 4;
  return s;
}

/**
 * Ordena para a lista: primeiro o que bate com a busca; depois o idioma de quem busca e os registros
 * mais completos (autor, capa, páginas, ISBN, editora). Empate mantém a ordem das bases.
 * Resultados que não têm nem metade das palavras digitadas saem, se sobrar algum que tenha.
 */
export function rankBooks(items, { lang = 'pt', limit = 8, query = '' } = {}) {
  const scored = items.map((b, i) => {
    const rel = relevance(b, query);
    const extra = (b.lang === lang ? 4 : b.lang ? 0 : 1) + (b.author ? 2 : 0)
      + (b.cover ? 1 : 0) + (b.pages ? 1 : 0) + (b.isbn ? 1 : 0) + (b.publisher ? 1 : 0) + (b.srcs?.length > 1 ? 1 : 0);
    return { b, i, rel, s: rel * 2 + extra };
  });
  const good = query ? scored.filter((x) => x.rel >= 4) : scored;
  return (good.length ? good : scored).sort((x, y) => y.s - x.s || x.i - y.i).slice(0, limit).map((x) => x.b);
}
