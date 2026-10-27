// Dicionários gratuitos e sem chave, consultados direto do navegador:
// - Wikcionário em português (moderno, licença CC BY-SA);
// - Dicionário Aberto (reserva, quando o Wikcionário não tem a palavra);
// - Free Dictionary API (palavras em inglês).

const TIMEOUT = 8000;
// uma nova tentativa quando o serviço falha ou pede calma (429/5xx); "não existe" (404) não repete
async function get(url, retry = 1) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (r.ok) return await r.json();
    if (retry && (r.status === 429 || r.status >= 500)) throw new Error(String(r.status));
    return null;
  } catch {
    if (!retry) return null;
    await new Promise((ok) => setTimeout(ok, 700));
    return get(url, retry - 1);
  }
}

// "Memória," → "memória"; mantém hífen e apóstrofo do meio ("guarda-chuva", "don't")
export function cleanWord(s) {
  return String(s || '').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/\s+/g, ' ');
}

// Seção "Português" de uma página do Wikcionário: sentidos por classe (substantivo, verbo…),
// sinônimos, antônimos e anagramas, cada um na sua seção da página
const LIST_SECTIONS = { synonyms: /^sin[ôó]nimos?/i, antonyms: /^ant[ôó]nimos?/i, anagrams: /^anagramas?/i };
// seções que não são classe de palavra (não trazem sentidos)
const NOT_POS = /^(etimologia|pronúncia|ver também|tradução|traduções|referências|notas?|expressões|verbetes derivados|divisão silábica|fontes|no wik|na wikip|hiperônimos|hipônimos|parônimos|cognatos|descendentes|conjugação|declinação|flexão)/i;
// palavras de uma seção de lista: os links (ou o texto separado por vírgulas)
function wordsOf(el) {
  const links = [...el.querySelectorAll('li a, .divcols a, p a')].map((a) => a.textContent.trim());
  const raw = links.length ? links : el.textContent.split(/[,;\n•]/);
  // "De 4: nível" (sinônimo do 4º sentido) vira só "nível"
  return raw.map((x) => x.replace(/\(.*?\)/g, '').replace(/^de \d+\s*[:.]?/i, '').trim()).filter((x) => x && !/:$/.test(x) && x.length < 40 && /\p{L}/u.test(x));
}
async function wiktionary(word) {
  const r = await get(`https://pt.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=text&format=json&origin=*&formatversion=2&redirects=1`);
  if (!r?.parse?.text) return null;
  const doc = new DOMParser().parseFromString(r.parse.text, 'text/html');
  const root = doc.querySelector('.mw-parser-output');
  if (!root) return null;
  let on = false, pos = '', section = '';
  const defs = [];
  const lists = { synonyms: [], antonyms: [], anagrams: [] };
  for (const el of root.children) {
    const h = el.matches('.mw-heading') ? el.querySelector('h1, h2, h3, h4, h5') : /^H[1-5]$/.test(el.tagName) ? el : null;
    if (h && h.tagName === 'H1') { if (on) break; on = /portugu/i.test(h.id || h.textContent); continue; }
    if (!on) continue;
    if (h) {
      const title = h.textContent.replace(/\[.*?\]/g, '').trim();
      section = Object.keys(LIST_SECTIONS).find((k) => LIST_SECTIONS[k].test(title)) || '';
      // um título de nível 2 que não é seção conhecida é uma classe de palavra; sub-seções encerram os sentidos
      if (h.tagName === 'H2') pos = section || NOT_POS.test(title) ? '' : title;
      else if (!section) pos = '';
      if (section) pos = '';
      continue;
    }
    if (el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
    if (section) { lists[section].push(...wordsOf(el)); continue; }
    if (!pos || el.tagName !== 'OL') continue;
    for (const li of el.children) {
      const c = li.cloneNode(true);
      c.querySelectorAll('ul, dl, ol, sup, style').forEach((x) => x.remove());
      const text = c.textContent.replace(/\s+/g, ' ').trim().replace(/:$/, '');
      if (text) defs.push({ pos, text });
    }
  }
  const uniq = (a) => [...new Map(a.filter((x) => norm(x) !== norm(r.parse.title)).map((x) => [norm(x), x])).values()].slice(0, 20);
  return defs.length ? {
    word: r.parse.title, lang: 'pt', defs,
    synonyms: uniq(lists.synonyms), antonyms: uniq(lists.antonyms), anagrams: uniq(lists.anagrams),
    source: { name: 'Wikcionário', url: `https://pt.wiktionary.org/wiki/${encodeURIComponent(r.parse.title)}` },
  } : null;
}

// Palavra-base quando a página só diz que é uma flexão ("... do verbo correr", "plural de casa", "ver efémero")
// Só quando o primeiro sentido já é a flexão: "ensejo" é substantivo antes de ser forma de "ensejar"
function baseOf(defs) {
  const { text = '' } = defs[0] || {};
  const m = text.match(/(?:do verbo|de|ver|o mesmo que)\s+([\p{L}-]+)\.?$/iu);
  return m && /^(.*(plural|feminino|masculino|diminutivo|aumentativo|flexão|pessoa|particípio|gerúndio)|ver |o mesmo que)/i.test(text) ? m[1] : '';
}

async function dicionarioAberto(word) {
  const r = await get(`https://api.dicionario-aberto.net/word/${encodeURIComponent(word)}`);
  if (!Array.isArray(r) || !r.length) return null;
  const defs = [];
  for (const e of r.slice(0, 2)) {
    for (const sense of String(e.xml || '').split('<sense').slice(1)) {
      const pos = (sense.match(/<gramGrp>([^<]*)<\/gramGrp>/) || [])[1] || '';
      const def = (sense.match(/<def>([\s\S]*?)<\/def>/) || [])[1] || '';
      for (const line of def.replace(/<[^>]+>/g, '').split('\n').map((x) => x.trim()).filter(Boolean)) defs.push({ pos, text: line.replace(/_/g, '') });
    }
  }
  return defs.length ? { word, lang: 'pt', defs, source: { name: 'Dicionário Aberto', url: `https://dicionario-aberto.net/search/${encodeURIComponent(word)}` } } : null;
}

async function english(word) {
  const r = await get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!Array.isArray(r) || !r.length) return null;
  const meanings = r.flatMap((e) => e.meanings || []);
  const defs = meanings.flatMap((m) => (m.definitions || []).map((d) => ({ pos: m.partOfSpeech || '', text: d.definition })));
  const all = (k) => [...new Set(meanings.flatMap((m) => [...(m[k] || []), ...(m.definitions || []).flatMap((d) => d[k] || [])]))].slice(0, 20);
  return defs.length ? {
    word: r[0].word || word, lang: 'en', defs, phonetic: r[0].phonetic || '', synonyms: all('synonyms'), antonyms: all('antonyms'), anagrams: [],
    source: { name: 'Free Dictionary', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}` },
  } : null;
}

async function portuguese(word) {
  const variants = [...new Set([word.toLowerCase(), word])];
  for (const w of variants) {
    const r = await wiktionary(w);
    if (!r) continue;
    // flexão: traz também o significado da palavra-base
    const base = baseOf(r.defs);
    if (base && norm(base) !== norm(r.word)) {
      const b = await wiktionary(base);
      // sentidos e sinônimos da palavra-base; anagramas são da palavra como foi lida
      if (b) return { ...r, base: b.word, defs: [...r.defs.slice(0, 2), ...b.defs], synonyms: r.synonyms.length ? r.synonyms : b.synonyms, antonyms: r.antonyms.length ? r.antonyms : b.antonyms };
    }
    return r;
  }
  for (const w of variants) {
    const r = await dicionarioAberto(w);
    if (r) return r;
  }
  return null;
}
const norm = (s) => String(s || '').toLowerCase();

/**
 * Procura o significado de uma palavra (ou expressão curta).
 * @param {string} raw palavra como foi selecionada
 * @param {'pt'|'en'} [prefer] idioma a tentar primeiro
 * @returns {Promise<null | {word:string, lang:'pt'|'en', defs:{pos:string,text:string}[], synonyms:string[], antonyms:string[], anagrams:string[], base?:string, phonetic?:string, source:{name:string,url:string}}>}
 */
export async function lookup(raw, prefer = 'pt') {
  const word = cleanWord(raw);
  if (!word || word.length > 60) return null;
  const order = prefer === 'en' ? [english, portuguese] : [portuguese, english];
  for (const fn of order) {
    const r = await fn(word);
    if (r) return { synonyms: [], antonyms: [], anagrams: [], ...r, defs: r.defs.slice(0, 30) };
  }
  return null;
}

// Frase em volta da palavra, para lembrar onde ela apareceu
export function sentenceAround(text, word) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = t.split(/(?<=[.!?…])\s+/);
  const w = word.toLowerCase();
  const hit = parts.find((p) => p.toLowerCase().includes(w)) || '';
  return hit.length > 260 ? `${hit.slice(Math.max(0, hit.toLowerCase().indexOf(w) - 120), hit.toLowerCase().indexOf(w) + 140).trim()}…` : hit;
}
