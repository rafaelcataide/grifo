// Exportar para outros apps (Plus): Markdown para Obsidian e Notion (.zip) e cards para o Anki (.txt).
// As funções que montam o conteúdo são puras (testadas no Node); só o .zip usa uma biblioteca, carregada na hora.

const FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
const PURPOSE_PT = { hobby: 'Hobby', professional: 'Profissional', academic: 'Acadêmico' };
const STATUS_PT = { want: 'Quero ler', reading: 'Lendo', finished: 'Lido', abandoned: 'Abandonado' };

// nome de arquivo seguro (o Obsidian liga [[Título]] ao arquivo "Título.md")
export const fileName = (s) => String(s || 'Sem título').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sem título';
const yaml = (v) => (typeof v === 'number' ? v : `"${String(v ?? '').replace(/"/g, '\\"')}"`);
const quote = (t) => String(t || '').split('\n').map((l) => `> ${l}`).join('\n');

/**
 * Arquivos Markdown: um por livro/artigo (com as notas), um por nota com título e um por tema.
 * @returns {{path: string, content: string}[]}
 */
export function markdownFiles({ books = [], articles = [], notes = [] }) {
  const files = [];
  const used = new Set();
  const unique = (dir, name) => {
    let base = fileName(name), n = 2, path = `${dir}/${base}.md`;
    while (used.has(path.toLowerCase())) path = `${dir}/${base} (${n++}).md`;
    used.add(path.toLowerCase());
    return path;
  };
  const themes = new Map();
  for (const b of [...books, ...articles]) {
    const art = b.kind === 'article';
    const front = [
      '---',
      `tipo: ${art ? 'artigo' : 'livro'}`,
      b.author ? `autor: ${yaml(b.author)}` : '',
      art && b.url ? `link: ${yaml(b.url)}` : '',
      art && b.site ? `site: ${yaml(b.site)}` : '',
      b.genre ? `tema: ${yaml(b.genre)}` : '',
      b.subtheme ? `subtema: ${yaml(b.subtheme)}` : '',
      `finalidade: ${yaml(PURPOSE_PT[b.purpose || 'hobby'])}`,
      `status: ${yaml(STATUS_PT[b.status] || 'Quero ler')}`,
      b.pages ? `paginas: ${b.pages}` : '',
      b.rating ? `avaliacao: ${b.rating}` : '',
      b.endDate ? `concluido: ${yaml(b.endDate)}` : '',
      'tags: [grifo]',
      '---',
    ].filter(Boolean).join('\n');
    const mine = notes.filter((n) => n.bookId === b.id).sort((x, y) => (x.page || 0) - (y.page || 0) || x.createdAt - y.createdAt);
    const body = [
      `# ${b.title}`,
      [b.author, b.genre ? `[[${b.genre}]]` : '', b.subtheme ? `[[${b.subtheme}]]` : ''].filter(Boolean).join(' · '),
      b.review ? `\n## Resenha\n${b.review}` : '',
      mine.length ? `\n## Grifos e notas (${mine.length})` : '',
      ...mine.map((n) => [
        n.title ? `\n### [[${fileName(n.title)}]]` : '\n---',
        n.kind === 'quote' ? quote(n.text) : n.text,
        [n.page ? `p. ${n.page}` : '', ...(n.tags || []).map((t) => `#${String(t).replace(/\s+/g, '-')}`)].filter(Boolean).join(' · '),
      ].filter(Boolean).join('\n')),
    ].filter(Boolean).join('\n');
    files.push({ path: unique(art ? 'Artigos' : 'Livros', b.title), content: `${front}\n\n${body}\n` });
    if (b.genre) {
      if (!themes.has(b.genre)) themes.set(b.genre, []);
      themes.get(b.genre).push(b);
    }
  }
  // notas com título viram arquivo próprio: outras notas citam com [[título]]
  for (const n of notes.filter((x) => x.title)) {
    const src = [...books, ...articles].find((b) => b.id === n.bookId);
    files.push({ path: unique('Notas', n.title), content: `---\ntipo: nota\n${src ? `fonte: "[[${fileName(src.title)}]]"\n` : ''}tags: [grifo]\n---\n\n# ${n.title}\n\n${n.kind === 'quote' ? quote(n.text) : n.text}\n${src ? `\n— [[${fileName(src.title)}]]${n.page ? `, p. ${n.page}` : ''}\n` : ''}` });
  }
  // notas sem livro e sem título ficam juntas num arquivo
  const loose = notes.filter((n) => !n.title && ![...books, ...articles].some((b) => b.id === n.bookId));
  if (loose.length) {
    files.push({ path: unique('Notas', 'Notas soltas'), content: `# Notas soltas\n\n${loose.map((n) => [n.kind === 'quote' ? quote(n.text) : n.text, (n.tags || []).map((t) => `#${String(t).replace(/\s+/g, '-')}`).join(' ')].filter(Boolean).join('\n')).join('\n\n---\n\n')}\n` });
  }
  for (const [theme, list] of themes) {
    files.push({ path: unique('Temas', theme), content: `# ${theme}\n\n${list.map((b) => `- [[${fileName(b.title)}]]${b.subtheme ? ` · ${b.subtheme}` : ''}`).join('\n')}\n` });
  }
  return files;
}

// Tabela de livros e artigos para importar como banco de dados no Notion
export function booksCsv({ books = [], articles = [] }) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Título', 'Tipo', 'Autor', 'Tema', 'Subtema', 'Finalidade', 'Status', 'Páginas', 'Avaliação', 'Link']];
  for (const b of [...books, ...articles]) {
    rows.push([b.title, b.kind === 'article' ? 'Artigo' : 'Livro', b.author, b.genre, b.subtheme, PURPOSE_PT[b.purpose || 'hobby'], STATUS_PT[b.status] || '', b.pages || '', b.rating || '', b.url || '']);
  }
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Cards no formato de texto do Anki (2.1.55+): uma linha por card, separada por tab, com tipo e baralho.
 * Lacunas {{termo}} viram {{c1::termo}} (tipo Cloze).
 */
export function ankiText({ books = [], articles = [], cards = [] }) {
  const src = new Map([...books, ...articles].map((b) => [b.id, b]));
  const clean = (t) => String(t || '').replace(/\[\[([^[\]]+?)\]\]/g, (m, x) => x.split('|').pop()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const deck = (c) => `Grifo::${fileName(src.get(c.bookId)?.title || 'Geral').replace(/::/g, ' ')}`;
  const lines = ['#separator:tab', '#html:true', '#notetype column:1', '#deck column:2', '#tags column:5'];
  for (const c of cards) {
    const tags = ['grifo', src.get(c.bookId)?.genre].filter(Boolean).map((t) => String(t).replace(/\s+/g, '_')).join(' ');
    if (c.type === 'cloze') {
      let k = 0;
      const text = clean(c.front).replace(/\{\{(.+?)\}\}/g, (m, x) => `{{c${++k}::${x}}}`);
      lines.push(['Cloze', deck(c), text, '', tags].join('\t'));
    } else {
      lines.push(['Basic', deck(c), clean(c.front), clean(c.back), tags].join('\t'));
    }
  }
  return `${lines.join('\n')}\n`;
}

// Junta os arquivos num .zip (biblioteca fflate, carregada só quando a pessoa exporta)
export async function zip(files) {
  const { zipSync, strToU8 } = await import(FFLATE);
  return new Blob([zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.content)])))], { type: 'application/zip' });
}
