// OCR de páginas de livro com detecção de trechos grifados (marca-texto).
// 1) acha pixels com cor de marca-texto (amarelo, verde, rosa, azul, laranja);
// 2) agrupa em linhas e trechos; 3) apaga tudo fora do grifo; 4) roda o Tesseract em cada trecho.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_SIDE = 2200;

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

  // Fecha buracos deixados pelas letras: dilata 2 blocos na horizontal e 1 na vertical
  const dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!mask[y * gw + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < gw) dil[yy * gw + xx] = 1;
        }
      }
    }
  }

  // Componentes conectados = linhas grifadas
  const seen = new Uint8Array(gw * gh);
  const comps = [];
  for (let start = 0; start < dil.length; start++) {
    if (!dil[start] || seen[start]) continue;
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
        if (q < 0 || q >= dil.length || seen[q] || !dil[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === gw - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const cw = (x1 - x0 + 1) * B, ch = (y1 - y0 + 1) * B;
    // descarta ruído, manchas grandes (capa, mão) e formas que não parecem linha de texto
    if (area < 8 || cw < w * 0.05 || ch > h * 0.25 || cw / ch < 1.5) continue;
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

function cleanText(t, keepParagraphs) {
  let s = t.replace(/-\n(?=\p{Ll})/gu, '');
  s = keepParagraphs ? s.replace(/([^\n])\n(?!\n)/g, '$1 ') : s.replace(/\s*\n\s*/g, ' ');
  return s
    .split('\n')
    .map((l) => l.replace(/[|~_«»]+/g, '').replace(/[ \t]{2,}/g, ' ').trim())
    .filter((l) => (l.match(/\p{L}/gu) || []).length >= 2)
    .join('\n')
    .trim();
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
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const src = canvasOf(w, h);
  const sctx = src.getContext('2d', { willReadFrequently: true });
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
  const texts = [];
  try {
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      const pad = mode === 'highlight' ? 10 : 0;
      const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
      const cw = Math.min(w, b.x1 + pad) - x0, ch = Math.min(h, b.y1 + pad) - y0;
      const crop = canvasOf(cw, ch);
      crop.getContext('2d').drawImage(out, x0, y0, cw, ch, 0, 0, cw, ch);
      logger = (msg, p) => onProgress(boxes.length > 1 ? `${msg} (trecho ${k + 1}/${boxes.length})` : msg, p);
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
