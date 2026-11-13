// PDFs: leitura com o pdf.js (o leitor do Firefox), texto selecionável para grifar
// e importação dos grifos já feitos no arquivo em outros apps (Adobe, Xodo, leitor do celular).
// A biblioteca é grande (~1,7 MB) e só é carregada quando um PDF é aberto.

const BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284';
let libPromise = null;

function pdfjs() {
  libPromise ||= import(`${BASE}/build/pdf.min.mjs`).then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${BASE}/build/pdf.worker.min.mjs`;
    // estilos da camada de texto (deixa o texto invisível por cima da página, para selecionar)
    if (!document.querySelector('link[data-pdfjs]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = `${BASE}/web/pdf_viewer.css`;
      l.dataset.pdfjs = '1';
      document.head.append(l);
    }
    return m;
  }).catch((e) => { libPromise = null; throw new Error(`Não foi possível carregar o leitor de PDF (${e.message}).`); });
  return libPromise;
}

export async function openPdf(blob) {
  const m = await pdfjs();
  return m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
}

export async function info(doc, fileName = '') {
  const meta = await doc.getMetadata().catch(() => ({}));
  const t = String(meta?.info?.Title || '').trim();
  return {
    title: t && !/^(untitled|sem título|microsoft word)/i.test(t) ? t : fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim(),
    author: String(meta?.info?.Author || '').trim(),
    pages: doc.numPages,
  };
}

// Desenha a página na largura dada, com a camada de texto por cima
export async function renderPage(doc, n, box, width) {
  const m = await pdfjs();
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const text = document.createElement('div');
  text.className = 'textLayer';
  box.style.setProperty('--scale-factor', viewport.scale);
  box.style.width = `${Math.floor(viewport.width)}px`;
  box.style.height = `${Math.floor(viewport.height)}px`;
  box.replaceChildren(canvas, text);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
  await new m.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
  return viewport.height;
}

// Retângulos de um grifo (quadPoints pode vir plano [x1,y1,...x4,y4] ou como pontos {x,y})
function rects(a) {
  const q = a.quadPoints;
  const out = [];
  if (!q || !q.length) return a.rect ? [a.rect] : out;
  if (typeof q[0] === 'number') {
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  } else {
    for (const quad of q) {
      const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return out;
}

// Texto que fica embaixo de cada retângulo grifado (corta pelo meio quando o grifo pega parte da linha)
export function textUnder(items, boxes) {
  const parts = [];
  for (const [x0, y0, x1, y1] of boxes) {
    const line = [];
    for (const it of items) {
      if (!it.str) continue;
      const x = it.transform[4], y = it.transform[5];
      const h = it.height || Math.abs(it.transform[3]) || 10;
      const w = it.width || 0;
      const overlapY = Math.min(y + h, y1) - Math.max(y, y0);
      if (overlapY < h * 0.5 || x + w < x0 || x > x1) continue;
      let s = it.str;
      if (w > 0) {
        // corte proporcional à largura, completado até o começo e o fim das palavras
        const isW = (ch) => /[\p{L}\p{N}]/u.test(ch || '');
        let a = Math.max(0, Math.floor(((x0 - x) / w) * s.length));
        let b = Math.min(s.length, Math.ceil(((x1 - x) / w) * s.length));
        while (a > 0 && isW(s[a - 1]) && isW(s[a])) a--;
        while (b < s.length && isW(s[b - 1]) && isW(s[b])) b++;
        s = s.slice(a, b);
      }
      line.push([x, s]);
    }
    line.sort((p, q) => p[0] - q[0]);
    parts.push(line.map((p) => p[1]).join(''));
  }
  return parts.join(' ').replace(/-\s+(?=\p{Ll})/gu, '').replace(/\s+/g, ' ').trim();
}

// Grifos (e sublinhados) já feitos no arquivo: [{ page, text, comment }]
export async function existingHighlights(doc) {
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const annots = (await page.getAnnotations()).filter((a) => ['Highlight', 'Underline', 'Squiggly'].includes(a.subtype));
    if (!annots.length) continue;
    const { items } = await page.getTextContent();
    for (const a of annots) {
      const text = textUnder(items, rects(a));
      const comment = String(a.contentsObj?.str ?? a.contents ?? '').trim();
      if (text.length >= 3) out.push({ page: n, text, comment });
    }
  }
  return out;
}

// Seleção em PDF de duas colunas (artigos científicos): o navegador costuma levar a seleção para a
// coluna do lado quando o mouse/dedo passa pelo vão entre elas. Refaz o texto seguindo a coluna onde a
// seleção começou: se o fim caiu na outra coluna na mesma altura (ou abaixo), é a mesma coluna até ali;
// se caiu acima, a leitura continua no topo da coluna seguinte. Devolve null quando não se aplica.
export function columnText(range) {
  const el = (n) => (n.nodeType === 3 ? n.parentElement : n);
  const layer = el(range.startContainer)?.closest('.textLayer');
  if (!layer || layer !== el(range.endContainer)?.closest('.textLayer')) return null;
  const spans = [...layer.querySelectorAll('span')].filter((s) => !s.querySelector('span') && s.textContent.trim());
  if (spans.length < 8) return null;
  const box = layer.getBoundingClientRect();
  const mid = box.left + box.width / 2;
  const rect = new Map(spans.map((s) => [s, s.getBoundingClientRect()]));
  const colOf = (s) => { const r = rect.get(s); return r.right <= mid + 6 ? 0 : r.left >= mid - 6 ? 1 : -1; }; // -1: largura toda
  const left = spans.filter((s) => colOf(s) === 0).length, right = spans.filter((s) => colOf(s) === 1).length;
  if (left < spans.length * 0.25 || right < spans.length * 0.25) return null; // não é página em duas colunas
  const spanOf = (n) => { const e = el(n); return e?.closest('.textLayer span') && spans.includes(e.closest('.textLayer span')) ? e.closest('.textLayer span') : null; };
  const a = spanOf(range.startContainer), b = spanOf(range.endContainer);
  if (!a || !b) return null;
  const ca = colOf(a), cb = colOf(b);
  if (ca === -1 || cb === -1 || (ca === cb)) return null; // mesma coluna: a seleção normal já está certa
  const ya = rect.get(a).top, yb = rect.get(b).top;
  const inCol = (c) => spans.filter((s) => colOf(s) === c).sort((p, q) => rect.get(p).top - rect.get(q).top || rect.get(p).left - rect.get(q).left);
  const startCut = range.startContainer.nodeType === 3 ? range.startOffset : 0;
  let pick, endCut = null;
  if (yb >= ya - 2) {
    // o fim "escorregou" para a outra coluna: fica na coluna do começo, até a altura do fim
    pick = inCol(ca).filter((s) => rect.get(s).top >= ya - 1 && rect.get(s).top <= yb + 1);
  } else {
    pick = [...inCol(ca).filter((s) => rect.get(s).top >= ya - 1), ...inCol(cb).filter((s) => rect.get(s).top <= yb + 1)];
    endCut = range.endContainer.nodeType === 3 ? range.endOffset : null;
  }
  let out = '';
  for (const s of pick) {
    let t = s.textContent;
    if (s === b && endCut != null) t = t.slice(0, endCut);
    if (s === a) t = t.slice(startCut);
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // palavra quebrada no fim da linha ("pre- visão") volta a ser uma só
    out = /\p{L}-$/u.test(out) && /^\p{Ll}/u.test(t) ? out.slice(0, -1) + t : out ? `${out} ${t}` : t;
  }
  return out.trim() || null;
}

// ---------- grifos desenhados por cima da página ----------
// Junta os retângulos de uma seleção em faixas por linha (o navegador devolve um por pedaço de texto)
function lineBands(list) {
  const rs = list.filter((r) => r.width > 1 && r.height > 1).map((r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out = [];
  for (const r of rs) {
    const h = r.y1 - r.y0;
    const hit = out.find((o) => Math.min(o.y1, r.y1) - Math.max(o.y0, r.y0) > Math.min(h, o.y1 - o.y0) * 0.5 && r.x0 <= o.x1 + h * 1.5 && r.x1 >= o.x0 - h * 1.5);
    if (hit) { hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1); hit.y0 = Math.min(hit.y0, r.y0); hit.y1 = Math.max(hit.y1, r.y1); } else out.push({ ...r });
  }
  return out;
}

/** Retângulos de um trecho selecionado, em frações (0 a 1) da página: [[x, y, largura, altura], …]. */
export function rangeRects(range, pageEl) {
  const box = pageEl.getBoundingClientRect();
  if (!box.width || !box.height) return [];
  const f = (n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  return lineBands([...range.getClientRects()])
    .filter((r) => r.x1 > box.left && r.x0 < box.right && r.y1 > box.top && r.y0 < box.bottom && r.x1 - r.x0 < box.width * 0.98)
    .map((r) => [f((r.x0 - box.left) / box.width), f((r.y0 - box.top) / box.height), f((r.x1 - r.x0) / box.width), f((r.y1 - r.y0) / box.height)]);
}

/**
 * Acha um texto na camada de texto da página (ignora espaços, hífens de quebra de linha e maiúsculas)
 * e devolve os retângulos dele, ou [] se não achar. Serve para os grifos antigos e os importados do arquivo.
 */
export function findTextRects(pageEl, text) {
  const layer = pageEl.querySelector('.textLayer');
  if (!layer) return [];
  const skip = /[\s\-\u00ad\u2010\u2011]/;
  const needle = [...String(text)].filter((ch) => !skip.test(ch)).join('').toLowerCase();
  if (needle.length < 3) return [];
  let hay = '';
  const pos = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.data.length; i++) {
      if (skip.test(n.data[i])) continue;
      const low = n.data[i].toLowerCase();
      if (low.length !== 1) continue;
      hay += low;
      pos.push([n, i]);
    }
  }
  const at = hay.indexOf(needle);
  if (at < 0) return [];
  const range = document.createRange();
  range.setStart(pos[at][0], pos[at][1]);
  const end = pos[at + needle.length - 1];
  range.setEnd(end[0], end[1] + 1);
  return rangeRects(range, pageEl);
}

/** Desenha os grifos (notas) de uma página já renderizada. Devolve quantos foram desenhados. */
export function paintHighlights(pageEl, notes) {
  pageEl.querySelectorAll('.pdf-hl').forEach((x) => x.remove());
  const layer = pageEl.querySelector('.textLayer');
  if (!layer) return 0;
  let n = 0;
  for (const note of notes) {
    const quote = String(note.text || '').split('\n\n')[0]; // a reflexão escrita depois do trecho não está no PDF
    const rects = note.rects?.length ? note.rects : findTextRects(pageEl, quote);
    if (!rects.length) continue;
    n++;
    for (const [x, y, w, h] of rects) {
      const d = document.createElement('div');
      d.className = 'pdf-hl';
      d.dataset.note = note.id;
      d.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
      pageEl.insertBefore(d, layer);
    }
  }
  return n;
}
