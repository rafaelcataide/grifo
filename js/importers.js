// Importadores: grifos do Kindle (My Clippings.txt) e planilhas do Goodreads, Skoob ou qualquer CSV.

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------------- Kindle ----------------
function kindleAuthor(raw) {
  const a = raw.trim();
  // "Clear, James" → "James Clear" (só quando há exatamente uma vírgula)
  const parts = a.split(',');
  return parts.length === 2 && !a.includes(';') ? `${parts[1].trim()} ${parts[0].trim()}` : a;
}

export function parseKindle(text) {
  const books = new Map();
  const chunks = text.replace(/^﻿/, '').replace(/\r/g, '').split(/^=+\s*$/m);
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.replace(/^﻿/, '').trim());
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length < 3) continue;
    const head = lines[0];
    const meta = lines[1];
    const body = lines.slice(2).join('\n').trim();
    if (/marcador|bookmark|signet|marcapáginas/i.test(meta) || !body) continue;
    const kind = /\bnota\b|\bnote\b/i.test(meta) && !/destaque|highlight/i.test(meta) ? 'thought' : 'quote';
    const m = head.match(/^(.*)\(([^()]*)\)\s*$/);
    const title = (m ? m[1] : head).trim();
    const author = m ? kindleAuthor(m[2]) : '';
    const page = Number((meta.match(/p[áa]gina\s+(\d+)|page\s+(\d+)/i) || []).slice(1).find(Boolean)) || null;
    const loc = Number((meta.match(/posi[çc][ãa]o\s+(\d+)|location\s+(\d+)/i) || []).slice(1).find(Boolean)) || null;
    const key = norm(title);
    if (!books.has(key)) books.set(key, { title, author, items: [] });
    books.get(key).items.push({ text: body, kind, page, loc });
  }
  // O Kindle repete o destaque quando você o estende: fica só a versão mais longa
  for (const b of books.values()) {
    b.items = b.items.filter((it, i) => !b.items.some((o, j) => j !== i && o.kind === it.kind && o.text.length > it.text.length && o.text.includes(it.text)));
    const seen = new Set();
    b.items = b.items.filter((it) => { const k = `${it.kind}|${it.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  return [...books.values()].filter((b) => b.items.length);
}

// ---------------- CSV (Goodreads, Skoob, planilhas) ----------------
export function parseCSV(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split('\n')[0];
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const COLUMNS = {
  title: ['title', 'titulo', 'nome', 'livro', 'nome do livro'],
  author: ['author', 'autor', 'autores', 'autor(es)', 'author l-f'],
  pages: ['number of pages', 'paginas', 'pages', 'num pages', 'n de paginas', 'numero de paginas'],
  isbn: ['isbn13', 'isbn', 'isbn 13', 'isbn-13', 'isbn10'],
  rating: ['my rating', 'nota', 'avaliacao', 'rating', 'minha nota', 'minha avaliacao', 'estrelas'],
  status: ['exclusive shelf', 'status', 'estante', 'situacao', 'shelf', 'tipo', 'leitura'],
  endDate: ['date read', 'data de leitura', 'lido em', 'data lido', 'data de termino', 'termino', 'data de conclusao', 'concluido em'],
  startDate: ['date started', 'inicio', 'data de inicio', 'comecei em'],
  genre: ['genero', 'tema', 'categoria', 'genre'],
  review: ['my review', 'resenha', 'review', 'opiniao', 'comentario'],
};

function toDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // formato brasileiro dd/mm/aaaa
  return '';
}

function toStatus(v, hasEnd) {
  const s = norm(v);
  if (/currently|lendo|reading|em leitura/.test(s)) return 'reading';
  if (/to-read|quero|desejad|wish|to read|vou ler/.test(s)) return 'want';
  if (/abandon/.test(s)) return 'abandoned';
  if (/^read$|lido|lidos|leu|concluid|finished/.test(s)) return 'finished';
  return hasEnd ? 'finished' : 'want';
}

export function booksFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { books: [], source: 'csv', columns: [] };
  const header = rows[0].map(norm);
  const col = {};
  // a ordem dos nomes é a preferência (ex.: ISBN13 antes de ISBN)
  for (const [key, names] of Object.entries(COLUMNS)) {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) { col[key] = i; break; }
    }
  }
  if (col.title == null) throw new Error('não encontrei a coluna de título (title/título)');
  const source = header.includes('exclusive shelf') || header.includes('book id') ? 'goodreads' : 'csv';
  const get = (r, k) => (col[k] != null ? String(r[col[k]] ?? '').trim() : '');
  const books = rows.slice(1).map((r) => {
    const endDate = toDate(get(r, 'endDate'));
    const status = toStatus(get(r, 'status'), !!endDate);
    const rating = Math.round(Number(get(r, 'rating').replace(',', '.')) || 0);
    return {
      title: get(r, 'title').replace(/\s*\(.*?#\d+\)\s*$/, ''), // tira "(Série, #2)" do Goodreads
      author: get(r, 'author'),
      pages: Number(get(r, 'pages').replace(/\D/g, '')) || 0,
      isbn: get(r, 'isbn').replace(/[^\dX]/gi, ''),
      rating: Math.min(5, Math.max(0, rating)),
      status,
      endDate: status === 'finished' ? endDate : '',
      startDate: toDate(get(r, 'startDate')),
      genre: get(r, 'genre'),
      review: get(r, 'review').replace(/<br\s*\/?>/gi, '\n'),
    };
  }).filter((b) => b.title);
  return { books, source, columns: Object.keys(col) };
}
