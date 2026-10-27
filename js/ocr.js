// OCR de páginas de livro com detecção de trechos grifados (marca-texto colorido ou grifo cinza do Kindle).
// 1) acha pixels com cor de marca-texto (amarelo, verde, rosa, azul, laranja);
// 2) agrupa em linhas e trechos; 3) apaga tudo fora do grifo; 4) roda o Tesseract em cada trecho.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_SIDE = 2200;
const MIN_SIDE = 1600;

let scriptPromise, workerPromise, logger = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('não foi possível carregar o motor de OCR (verifique a internet no primeiro uso)'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

const STATUS_PT = {
  'loading tesseract core': 'Carregando motor de OCR',
  'initializing tesseract': 'Iniciando OCR',
  'loading language traineddata': 'Baixando dicionário português',
  'initializing api': 'Preparando leitura',
  'recognizing text': 'Lendo texto',
};

async function getWorker() {
  await loadTesseract();
  workerPromise ||= window.Tesseract.createWorker('por', 1, {
    logger: (m) => logger && logger(STATUS_PT[m.status] || m.status, m.progress),
  }).catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

function hue(r, g, b, mx, d) {
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// Cor de marca-texto: saturada; clara, ou mais escura se a cor for forte (marca-texto na sombra da página).
// Tons de pele/madeira (vermelho-alaranjado pouco saturado) são ignorados.
function isHighlight(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (mx < 80 || d < 40) return false;
  const sat = d / mx;
  if (sat < 0.25 || (mx < 130 && sat < 0.45)) return false;
  const h = hue(r, g, b, mx, d);
  if ((h < 45 || h >= 345) && sat < 0.55) return false;
  return true;
}

// Blocos com marca-texto colorido
function colorMask(img, B, gw, gh) {
  const { width: w, height: h, data } = img;
  const count = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / B) | 0) * gw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isHighlight(data[i], data[i + 1], data[i + 2])) count[row + ((x / B) | 0)]++;
    }
  }
  const mask = new Uint8Array(gw * gh);
  for (let i = 0; i < mask.length; i++) mask[i] = count[i] > B * B * 0.25 ? 1 : 0;
  return mask;
}

// Blocos com grifo cinza (Kindle e outros leitores de tinta eletrônica): faixa sem cor, um pouco mais
// escura que o branco da página ao redor. O "branco" é medido por região, porque a luz da foto é desigual.
function grayMask(img, B, gw, gh) {
  const { width: w, height: h, data } = img;
  const lum = (i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  // branco local: brilho do percentil 90 em células grandes, depois o maior entre as vizinhas
  const C = B * 6, cw = Math.ceil(w / C), ch = Math.ceil(h / C);
  const hist = new Uint32Array(cw * ch * 64);
  const tot = new Uint32Array(cw * ch);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const c = ((y / C) | 0) * cw + ((x / C) | 0);
      hist[c * 64 + (lum((y * w + x) * 4) >> 2)]++;
      tot[c]++;
    }
  }
  const p90 = new Float32Array(cw * ch);
  for (let c = 0; c < cw * ch; c++) {
    let acc = 0;
    const lim = tot[c] * 0.9;
    for (let b = 0; b < 64; b++) { acc += hist[c * 64 + b]; if (acc >= lim) { p90[c] = b * 4 + 2; break; } }
  }
  // vizinhança larga (~20% da foto): no meio de um grifo grande, as células perto também são cinza
  const R = Math.max(2, Math.round((Math.max(w, h) * 0.2) / C));
  const rowMax = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let m = 0;
      for (let xx = Math.max(0, cx - R); xx <= Math.min(cw - 1, cx + R); xx++) m = Math.max(m, p90[cy * cw + xx]);
      rowMax[cy * cw + cx] = m;
    }
  }
  const white = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let m = 0;
      for (let yy = Math.max(0, cy - R); yy <= Math.min(ch - 1, cy + R); yy++) m = Math.max(m, rowMax[yy * cw + cx]);
      white[cy * cw + cx] = m;
    }
  }
  // um bloco é grifo se boa parte dele é cinza-claro sem cor (o texto escuro dentro da faixa é tolerado)
  const gray = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / B) | 0) * gw;
    const crow = ((y / C) | 0) * cw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const W = white[crow + ((x / C) | 0)];
      if (W < 120) continue; // moldura preta do aparelho, sombras
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 28) continue;
      const k = lum(i) / W;
      if (k > 0.72 && k < 0.93) gray[row + ((x / B) | 0)]++;
    }
  }
  const mask = new Uint8Array(gw * gh);
  for (let i = 0; i < mask.length; i++) mask[i] = gray[i] > B * B * 0.45 ? 1 : 0;
  return mask;
}

// Quanto um recorte parece texto: fração de pixels escuros e quantas vezes claro/escuro se alternam
// por linha (letras). Toalha estampada, dedo ou capa colorida não passam.
export function textiness(img, p) {
  const { width: w, data } = img;
  const lum = (i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  const L = [];
  for (let y = p.y0; y < p.y1; y += 3) for (let x = p.x0; x < p.x1; x += 3) L.push(lum((y * w + x) * 4));
  if (!L.length) return { dark: 0, flips: 0 };
  L.sort((a, b) => a - b);
  const thr = L[Math.floor(L.length * 0.9)] * 0.62;
  let dark = 0, flips = 0, n = 0, rows = 0;
  for (let y = p.y0; y < p.y1; y += 2) {
    let prev = false;
    rows++;
    for (let x = p.x0; x < p.x1; x++) {
      const d = lum((y * w + x) * 4) < thr;
      if (d) dark++;
      if (d !== prev) flips++;
      prev = d;
      n++;
    }
  }
  return { dark: dark / n, flips: flips / rows / Math.max(1, p.x1 - p.x0) };
}
const looksLikeText = (t) => t.dark > 0.04 && t.dark < 0.45 && t.flips > 0.022;

// Trechos grifados de um tipo: 'color' (marca-texto colorido) ou 'gray' (grifo cinza do Kindle)
function findPassages(img, kind = 'color') {
  const { width: w, height: h } = img;
  const B = Math.max(6, Math.round(Math.max(w, h) / 300));
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B);
  const gray = kind === 'gray';
  // um grifo tem ao menos a altura de uma linha de texto e uma largura razoável; o resto é borda de letra ou ruído
  // (no grifo cinza, bordas de letras em negrito também parecem cinza: exige a altura de uma linha inteira)
  const bigEnough = (p) => p.y1 - p.y0 >= Math.max(h * 0.018, gray ? w * 0.028 : 0) && p.x1 - p.x0 >= w * 0.12;
  // espalha 5 blocos para os lados e fecha os buracos dentro do trecho: o traço do marca-texto falha nas pontas
  // das linhas, e a faixa cinza do Kindle começa colada na primeira letra (que é escura)
  const found = passagesFrom(gray ? grayMask(img, B, gw, gh) : colorMask(img, B, gw, gh), w, h, B, gw, gh, 5, 3);
  return { ...found, gray, passages: found.passages.filter((p) => bigEnough(p) && looksLikeText(textiness(img, p))) };
}
export const __test = { colorMask, grayMask, passagesFrom };

function passagesFrom(mask, w, h, B, gw, gh, spread = 2, close = 0) {
  const dilate = (src, rx, ry) => {
    const out = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!src[y * gw + x]) continue;
        for (let dy = -ry; dy <= ry; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= gh) continue;
          for (let dx = -rx; dx <= rx; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < gw) out[yy * gw + xx] = 1;
          }
        }
      }
    }
    return out;
  };
  const erode = (src, rx, ry) => {
    const out = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let all = 1;
        for (let dy = -ry; dy <= ry && all; dy++) {
          const yy = Math.min(gh - 1, Math.max(0, y + dy));
          for (let dx = -rx; dx <= rx; dx++) {
            const xx = Math.min(gw - 1, Math.max(0, x + dx));
            if (!src[yy * gw + xx]) { all = 0; break; }
          }
        }
        out[y * gw + x] = all;
      }
    }
    return out;
  };

  // Marca-texto forma faixas horizontais. Trechos curtos de cor em cada linha (borda colorida da página,
  // ilustração vizinha, dedo) são descartados antes de procurar os blocos, para não "colarem" no grifo.
  const minRun = Math.max(4, Math.round(gw * 0.06));
  for (let y = 0; y < gh; y++) {
    let x = 0;
    while (x < gw) {
      if (!mask[y * gw + x]) { x++; continue; }
      let end = x;
      // tolera falhas de 1 bloco dentro da faixa (letras escuras)
      while (end + 1 < gw && (mask[y * gw + end + 1] || (end + 2 < gw && mask[y * gw + end + 2]))) end++;
      if (end - x + 1 < minRun) for (let k = x; k <= end; k++) mask[y * gw + k] = 0;
      x = end + 1;
    }
  }

  // Fecha os buracos deixados pelas letras. "lines" (só na horizontal) separa as linhas grifadas;
  // "dil" (também 1 bloco na vertical) é o que se mantém da imagem, para não cortar acentos e "g", "p", "q".
  const lines = dilate(mask, spread, 0);
  const dil = dilate(lines, 0, 1);

  // Componentes conectados = linhas (ou blocos de linhas coladas) grifadas
  const seen = new Uint8Array(gw * gh);
  const comps = [];
  for (let start = 0; start < lines.length; start++) {
    if (!lines[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, area = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % gw, y = (p / gw) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - gw, p + gw]) {
        if (q < 0 || q >= lines.length || seen[q] || !lines[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === gw - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const cw = (x1 - x0 + 1) * B, ch = (y1 - y0 + 1) * B;
    // descarta ruído, faixas estreitas (borda colorida da página) e manchas que ocupam a foto (capa, ilustração).
    // Vários parágrafos grifados em sequência podem formar um bloco alto: isso é aceito.
    if (area < 4 || cw < w * 0.05 || cw / ch < 1.2 || cw * ch > w * h * 0.6) continue;
    comps.push({ x0: x0 * B, y0: y0 * B, x1: Math.min(w, (x1 + 1) * B), y1: Math.min(h, (y1 + 1) * B) });
  }

  // Junta linhas próximas no mesmo trecho
  comps.sort((a, b) => a.y0 - b.y0);
  const lineH = comps.length ? comps.map((c) => c.y1 - c.y0).sort((a, b) => a - b)[comps.length >> 1] : 0;
  const passages = [];
  for (const c of comps) {
    const last = passages[passages.length - 1];
    const overlapX = last && c.x0 < last.x1 && c.x1 > last.x0;
    if (last && overlapX && c.y0 - last.y1 < lineH * 1.2) {
      last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1);
      last.y1 = Math.max(last.y1, c.y1);
    } else {
      passages.push({ ...c });
    }
  }
  // grifo cinza: linhas com muitas letras deixam buracos na faixa. Fechar a máscara (expandir e encolher)
  // os preenche, mas só dentro de cada trecho já encontrado, para não puxar texto sem grifo ao redor.
  if (close) {
    const keep = dilate(dilate(erode(dilate(mask, 1, close), 1, close), spread, 0), 0, 1);
    dil.fill(0);
    for (const p of passages) {
      for (let y = Math.floor(p.y0 / B); y < Math.ceil(p.y1 / B); y++) {
        for (let x = Math.floor(p.x0 / B); x < Math.ceil(p.x1 / B); x++) dil[y * gw + x] = keep[y * gw + x] | lines[y * gw + x];
      }
    }
  }
  return { passages, dil, gw, B };
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Limpa cada linha (sobras da borda do grifo viram "|", "." ou uma letra solta no começo) e junta o texto
export function cleanText(t, keepParagraphs) {
  const lines = t.split('\n').map((l) => l
    .replace(/[|~_«»¦]+/g, ' ')
    .replace(/^[^\p{L}\p{N}"“(]+/u, '') // símbolos no começo
    .replace(/^\p{Ll}\s+(?=\p{Lu})/u, '') // letra minúscula solta antes de palavra maiúscula ("q Portanto")
    .replace(/[ \t]{2,}/g, ' ')
    .trim());
  let s = lines.join('\n').replace(/-\n(?=\p{Ll})/gu, '');
  s = keepParagraphs ? s.replace(/([^\n])\n(?!\n)/g, '$1 ') : s.replace(/\s*\n\s*/g, ' ');
  return s
    .split('\n')
    .filter((l) => (l.match(/\p{L}/gu) || []).length >= 2)
    .join('\n')
    .trim();
}

// Nas bordas do recorte aparecem pedaços das linhas vizinhas (fora do grifo), lidos com pouca confiança.
// Tira a primeira/última linha se for duvidosa e, nelas, as palavras duvidosas das pontas.
function trimEdges(data, gray = false) {
  const lines = (data.lines || []).map((l) => ({ conf: l.confidence, words: (l.words || []).map((w) => ({ t: w.text, c: w.confidence, x0: w.bbox?.x0 ?? 0, x1: w.bbox?.x1 ?? 0 })) }));
  if (!lines.length) return data.text || '';
  while (lines.length > 1 && lines[0].conf < 52) lines.shift();
  while (lines.length > 1 && lines[lines.length - 1].conf < 52) lines.pop();
  const first = lines[0].words, last = lines[lines.length - 1].words;
  while (first.length > 1 && first[0].c < 45) first.shift();
  while (last.length > 1 && last[last.length - 1].c < 45) last.pop();
  const join = () => lines.map((l) => l.words.map((w) => w.t).join(' ')).join('\n');
  if (gray) {
    // grifo cinza: espaço muito maior que o normal entre palavras = o resto da linha que ficou fora do grifo
    const gaps = lines.flatMap((l) => l.words.slice(1).map((w, i) => w.x0 - l.words[i].x1)).filter((g) => g > 0).sort((a, b) => a - b);
    const big = Math.max(12, (gaps[gaps.length >> 1] || 0) * 3);
    const cutAt = (ws) => ws.findIndex((w, i) => i > 0 && w.x0 - ws[i - 1].x1 > big);
    const k = cutAt(last);
    if (k > 0) last.splice(k);
    const j = cutAt(first);
    if (j > 0 && lines.length > 1) first.splice(0, j);
  }
  // letra solta ou símbolo nas pontas (pedaço de palavra cortada pela borda do grifo)
  const stray = (w) => w && (!/\p{L}/u.test(w.t) || (/^[^\p{L}]*\p{L}[^\p{L}]*$/u.test(w.t) && !/^[aeoéàAEOÉÀ]$/.test(w.t)));
  while (last.length > 1 && stray(last[last.length - 1])) last.pop();
  while (first.length > 1 && stray(first[0])) first.shift();
  return join();
}

// Preto e branco pelo método de Otsu, só sobre o que não é fundo branco. O cinza das faixas
// de marca-texto confunde o OCR (ele as trata como imagem); em preto e branco vira texto limpo.
// how: 'otsu' (um limite só), 'gray' (adaptativo forte, grifo cinza) ou 'soft' (adaptativo suave, marca-texto na sombra)
const ADAPT = { gray: { div: 8, k: 0.82, lo: 0.6, hi: 1.25 }, soft: { div: 4, k: 0.75, lo: 0.5, hi: 1.6 } };
function binarize(canvas, how = 'otsu') {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  const hist = new Array(256).fill(0);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 250) { hist[d[i]]++; n++; }
  if (!n) return;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  const A = ADAPT[how];
  if (!A) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] < thr ? 0 : 255;
    ctx.putImageData(im, 0, 0);
    return;
  }
  // Limiar adaptativo (Bradley): cada pixel é comparado com a média da vizinhança, então a luz desigual
  // da foto (um canto mais claro, sombra da mão) não apaga letras. O Otsu global só limita os extremos.
  const { width: W, height: H } = canvas;
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += d[(y * W + x) * 4];
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(W, H) / A.div));
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const v = d[(y * W + x) * 4];
      if (v >= 250) { out[y * W + x] = 255; continue; }
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const mean = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((y1 - y0) * (x1 - x0));
      out[y * W + x] = v < thr * A.lo || (v < mean * A.k && v < thr * A.hi) ? 0 : 255;
    }
  }
  for (let i = 0; i < out.length; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = out[i];
  ctx.putImageData(im, 0, 0);
}

function preview(source, w, h, boxes) {
  const s = Math.min(1, 640 / Math.max(w, h));
  const c = canvasOf(Math.round(w * s), Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0, c.width, c.height);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#5b4bdb';
  ctx.fillStyle = 'rgba(91,75,219,.18)';
  for (const b of boxes) {
    ctx.fillRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
    ctx.strokeRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
  }
  return c.toDataURL('image/jpeg', 0.8);
}

/**
 * @param {File} file foto da página
 * @param {'highlight'|'page'} mode só os grifos ou a página inteira
 * @param {(msg:string, progress?:number)=>void} onProgress
 * @param {{crop?: {x0:number, y0:number, x1:number, y1:number}}} [opts] crop: área escolhida, em frações (0 a 1) da foto
 * @returns {Promise<{text:string, regions:number, preview:string}>}
 */
export async function runOCR(file, mode, onProgress = () => {}, { crop } = {}) {
  onProgress('Preparando imagem');
  const bmp = await createImageBitmap(file);
  // só a área escolhida pela pessoa (o resto da foto nem entra na detecção)
  const sx = crop ? Math.round(crop.x0 * bmp.width) : 0, sy = crop ? Math.round(crop.y0 * bmp.height) : 0;
  const sw = crop ? Math.max(1, Math.round((crop.x1 - crop.x0) * bmp.width)) : bmp.width;
  const sh = crop ? Math.max(1, Math.round((crop.y1 - crop.y0) * bmp.height)) : bmp.height;
  // Fotos grandes são reduzidas; imagens pequenas (prints, fotos comprimidas por apps de mensagem, recortes)
  // são ampliadas, porque o OCR erra muito com letras de poucos pixels.
  const side = Math.max(sw, sh);
  const scale = side > MAX_SIDE ? MAX_SIDE / side : side < MIN_SIDE ? Math.min(4, MIN_SIDE / side) : 1;
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const src = canvasOf(w, h);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h);

  const worker = await getWorker();
  // grifo: cada recorte é um bloco de texto (modo 6); página inteira: detecção automática de colunas (modo 3)
  await worker.setParameters({ tessedit_pageseg_mode: mode === 'highlight' ? '6' : '3' });

  // Lê os recortes de uma imagem já preparada (out) e devolve o texto
  async function read(out, boxes, gray) {
    const texts = [];
    try {
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        const pad = mode === 'highlight' ? 10 : 0;
        const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
        const cw = Math.min(w, b.x1 + pad) - x0, ch = Math.min(h, b.y1 + pad) - y0;
        logger = (msg, p) => onProgress(boxes.length > 1 ? `${msg} (trecho ${k + 1}/${boxes.length})` : msg, p);
        // marca-texto colorido: a sombra da página escurece parte da faixa, e nenhum preto e branco serve para todas
        // as fotos; lê com o limite único e com o adaptativo suave e fica com a leitura de maior confiança
        const ways = mode === 'page' ? [null] : gray ? ['gray'] : ['otsu', 'soft'];
        let data = null;
        for (const how of ways) {
          const crop = canvasOf(cw, ch);
          crop.getContext('2d').drawImage(out, x0, y0, cw, ch, 0, 0, cw, ch);
          if (how) binarize(crop, how);
          globalThis.__ocrDebug?.push(crop); // inspeção em testes: o que exatamente vai para o OCR
          const r = (await worker.recognize(crop)).data;
          // pontuação: letras das palavras lidas com confiança razoável (mais texto bom, sem premiar lixo)
          r.score = (r.words || []).filter((x) => x.confidence >= 60).reduce((n, x) => n + (x.text.match(/\p{L}/gu) || []).length, 0);
          globalThis.__ocrScores?.push([how, r.score, Math.round(r.confidence)]);
          if (!data || r.score > data.score) data = r;
        }
        const t = cleanText(mode === 'highlight' ? trimEdges(data, gray) : data.text, mode === 'page');
        if (t) texts.push(t);
      }
    } finally {
      logger = null;
    }
    return texts.join('\n\n');
  }

  if (mode === 'page') {
    const out = canvasOf(w, h);
    const octx = out.getContext('2d');
    const proc = octx.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      proc.data[i] = proc.data[i + 1] = proc.data[i + 2] = v;
      proc.data[i + 3] = 255;
    }
    octx.putImageData(proc, 0, 0);
    return { text: await read(out, [{ x0: 0, y0: 0, x1: w, y1: h }], false), regions: 0, preview: preview(src, w, h, []) };
  }

  // Grifos: primeiro marca-texto colorido; se não achar ou não sair texto, o grifo cinza do Kindle
  onProgress('Procurando grifos');
  let last = { passages: [] };
  for (const kind of ['color', 'gray']) {
    const found = findPassages(img, kind);
    if (!found.passages.length) continue;
    last = found;
    const { passages, dil, gw, B } = found;
    // Mantém só o que está grifado; max(r,g,b) deixa o fundo colorido quase branco e o texto escuro
    const out = canvasOf(w, h);
    const octx = out.getContext('2d');
    const proc = octx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = ((y / B) | 0) * gw;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = dil[row + ((x / B) | 0)] ? Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) : 255;
        proc.data[i] = proc.data[i + 1] = proc.data[i + 2] = v;
        proc.data[i + 3] = 255;
      }
    }
    octx.putImageData(proc, 0, 0);
    const text = await read(out, passages, found.gray);
    if (text.replace(/[^\p{L}]/gu, '').length >= 8) return { text, regions: passages.length, preview: preview(src, w, h, passages) };
  }
  return { text: '', regions: last.passages.length, preview: preview(src, w, h, last.passages) };
}
