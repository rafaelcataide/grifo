// Idiomas do Grifo. O app é escrito em português; em inglês, um dicionário (i18n-en.js) traduz
// o que aparece na tela, nos avisos, nas janelas de confirmação e nas artes desenhadas em canvas.
// Textos dos usuários (títulos, notas) não estão no dicionário e ficam como foram escritos.
import { EN, EN_PATTERNS } from './i18n-en.js';
import { iconize } from './icons.js';

const KEY = 'grifo.lang';

function detect() {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    if (saved === 'pt' || saved === 'en') return saved;
  } catch { /* sem armazenamento */ }
  const nav = String(globalThis.navigator?.language || 'pt').toLowerCase();
  return nav.startsWith('pt') ? 'pt' : 'en';
}

export const lang = detect();
export const LOCALE = lang === 'en' ? 'en-US' : 'pt-BR';

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* sem armazenamento */ }
}

// Os rótulos começam com emoji ("📖 Registrar leitura"), que na tela vira ícone e sai do texto:
// o dicionário vale também sem o emoji do começo.
const LEAD_EMOJI = /^(?:[\p{Extended_Pictographic}←-⇿■-◿✓-✕]️?\s*)+/u;
for (const [k, v] of Object.entries(EN)) {
  const bare = k.replace(LEAD_EMOJI, '');
  if (bare !== k && bare && !(bare in EN)) EN[bare] = v.replace(LEAD_EMOJI, '');
}

// textos que já estão em inglês (resultado de uma tradução) não são traduzidos de novo
const OUTPUTS = new Set(Object.values(EN));
export const missing = new Set(); // para encontrar frases ainda sem tradução (window.__i18nMissing)

export function tr(s, quiet = false) {
  if (lang !== 'en' || typeof s !== 'string') return s;
  const key = s.trim();
  if (!key || !/\p{L}/u.test(key) || OUTPUTS.has(key)) return s;
  const hit = EN[key];
  if (hit !== undefined) return s.replace(key, hit);
  for (const [re, out] of EN_PATTERNS) {
    const m = key.match(re);
    if (m) {
      const value = typeof out === 'function' ? out(m, tr) : key.replace(re, out);
      OUTPUTS.add(value);
      return s.replace(key, value);
    }
  }
  if (!quiet) missing.add(key);
  return s;
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);

function translateNode(node) {
  if (node.nodeType === 3) {
    const p = node.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest('[data-no-tr]')) return;
    const t = tr(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
    iconize(node);
    return;
  }
  if (node.nodeType !== 1 || SKIP.has(node.tagName) || node.closest?.('[data-no-tr]')) return;
  for (const a of ATTRS) {
    const v = node.getAttribute?.(a);
    if (v) { const t = tr(v); if (t !== v) node.setAttribute(a, t); }
  }
  if (node.tagName === 'INPUT' && (node.type === 'button' || node.type === 'submit') && node.value) node.value = tr(node.value);
  if (node.tagName === 'OPTION' || node.tagName === 'BUTTON' || node.tagName === 'LABEL' || node.childNodes.length) {
    node.childNodes.forEach(translateNode);
  }
}

// Traduz (em inglês) e troca os emojis da interface por ícones (nos dois idiomas)
export function startTranslating(root = document.body) {
  if (lang === 'en') {
    document.documentElement.lang = 'en';
    document.title = tr(document.title);
  }
  translateNode(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (lang !== 'en') return;

  // janelas nativas (confirmar, perguntar, avisar)
  for (const fn of ['confirm', 'prompt', 'alert']) {
    const orig = window[fn].bind(window);
    window[fn] = (msg, ...rest) => orig(tr(String(msg ?? '')), ...rest);
  }
  // artes do Instagram desenhadas em canvas
  const C = CanvasRenderingContext2D.prototype;
  for (const fn of ['fillText', 'strokeText', 'measureText']) {
    const orig = C[fn];
    C[fn] = function (text, ...rest) { return orig.call(this, tr(String(text), true), ...rest); };
  }
  globalThis.__i18nMissing = missing;
}
