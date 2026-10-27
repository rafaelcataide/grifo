// Utilidades de texto usadas pelo app inteiro (sem tela: testáveis com node --test).
import { LOCALE } from './i18n.js';

// [[ligação]] ou [[ligação|apelido]] dentro das notas
export const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g;

// Escapa texto para colocar dentro de HTML
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Comparação de nomes: sem espaços nas pontas e sem maiúsculas
export const norm = (s) => String(s ?? '').trim().toLowerCase();

// Número no formato do idioma (1.234,5 / 1,234.5)
export const nf = (n) => Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: 1 });

// Destinos das [[ligações]] de uma nota
export const linksOf = (text) => [...String(text || '').matchAll(LINK_RE)].map((m) => m[1].split('|')[0].trim()).filter(Boolean);

// Texto sem a marcação [[ ]] (mostra o apelido quando houver)
export const plainText = (t) => String(t || '').replace(LINK_RE, (m, x) => x.split('|').pop());

// Tags: aceita "a; b, c" e "#a"; sem repetidas (ignora maiúsculas ao comparar)
export function splitTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of [].concat(list || [])) {
    for (const t of String(raw).split(/[;,]/)) {
      const tag = t.trim().replace(/^#+/, '').trim();
      const key = norm(tag);
      if (tag && !seen.has(key)) { seen.add(key); out.push(tag); }
    }
  }
  return out;
}
