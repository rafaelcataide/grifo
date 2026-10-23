// OCR de páginas de livro com detecção de trechos grifados (marca-texto).
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

// Cor de marca-texto: clara, saturada. Tons de pele/madeira (vermelho-alaranjado pouco saturado) são ignorados.
function isHighlight(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (mx < 130 || d < 45) return false;
  const sat = d / mx;
  if (sat < 0.25) return false;
  const h = hue(r, g, b, mx, d);
  if ((h < 45 || h >= 345) && sat < 0.55) return false;
  return true;
}

function findPassages(img) {
  const { width: w, height: h, data } = img;
  const B = Math.max(6, Math.round(Math.max(w, h) / 300));
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B);
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
  const lines = dilate(mask, 2, 0);
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
  return { passages, dil, gw, B };
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Limpa cada linha (sobras da borda do grifo viram "|", "." ou uma letra solta no começo) e junta o texto
function cleanText(t, keepParagraphs) {
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

// Preto e branco pelo método de Otsu, só sobre o que não é fundo branco. O cinza das faixas
// de marca-texto confunde o OCR (ele as trata como imagem); em preto e branco vira texto limpo.
function binarize(canvas) {
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
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] < thr ? 0 : 255;
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
 * @returns {Promise<{text:string, regions:number, preview:string}>}
 */
export async function runOCR(file, mode, onProgress = () => {}) {
  onProgress('Preparando imagem');
  const bmp = await createImageBitmap(file);
  // Fotos grandes são reduzidas; imagens pequenas (prints, fotos comprimidas por apps de mensagem)
  // são ampliadas, porque o OCR erra muito com letras de poucos pixels.
  const side = Math.max(bmp.width, bmp.height);
  const scale = side > MAX_SIDE ? MAX_SIDE / side : side < MIN_SIDE ? Math.min(4, MIN_SIDE / side) : 1;
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const src = canvasOf(w, h);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bmp, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h);

  const out = canvasOf(w, h);
  const octx = out.getContext('2d');
  const proc = octx.createImageData(w, h);
  let boxes = [];

  if (mode === 'highlight') {
    onProgress('Procurando grifos');
    const { passages, dil, gw, B } = findPassages(img);
    if (!passages.length) return { text: '', regions: 0, preview: preview(src, w, h, []) };
    boxes = passages;
    // Mantém só o que está grifado; max(r,g,b) deixa o fundo colorido quase branco e o texto escuro
    for (let y = 0; y < h; y++) {
      const row = ((y / B) | 0) * gw;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = dil[row + ((x / B) | 0)] ? Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) : 255;
        proc.data[i] = proc.data[i + 1] = proc.data[i + 2] = v;
        proc.data[i + 3] = 255;
      }
    }
  } else {
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      proc.data[i] = proc.data[i + 1] = proc.data[i + 2] = v;
      proc.data[i + 3] = 255;
    }
    boxes = [{ x0: 0, y0: 0, x1: w, y1: h }];
  }
  octx.putImageData(proc, 0, 0);

  const worker = await getWorker();
  // grifo: cada recorte é um bloco de texto (modo 6); página inteira: detecção automática de colunas (modo 3)
  await worker.setParameters({ tessedit_pageseg_mode: mode === 'highlight' ? '6' : '3' });
  const texts = [];
  try {
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      const pad = mode === 'highlight' ? 10 : 0;
      const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
      const cw = Math.min(w, b.x1 + pad) - x0, ch = Math.min(h, b.y1 + pad) - y0;
      const crop = canvasOf(cw, ch);
      crop.getContext('2d').drawImage(out, x0, y0, cw, ch, 0, 0, cw, ch);
      if (mode === 'highlight') binarize(crop);
      logger = (msg, p) => onProgress(boxes.length > 1 ? `${msg} (trecho ${k + 1}/${boxes.length})` : msg, p);
      globalThis.__ocrDebug?.push(crop); // inspeção em testes: o que exatamente vai para o OCR
      const { data } = await worker.recognize(crop);
      const t = cleanText(data.text, mode === 'page');
      if (t) texts.push(t);
    }
  } finally {
    logger = null;
  }
  return {
    text: texts.join('\n\n'),
    regions: mode === 'highlight' ? boxes.length : 0,
    preview: preview(src, w, h, mode === 'highlight' ? boxes : []),
  };
}
