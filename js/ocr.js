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

// Cor do papel: o tom mais comum entre os pixels claros da foto (o papel pode ser creme, ou azulado pela
// luz). Devolve as proporções de vermelho e verde (r/(r+g+b), g/(r+g+b)) e o brilho do papel.
export function paperColor(img) {
  const { width: w, height: h, data } = img;
  const lumHist = new Uint32Array(256);
  let n = 0;
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4;
      if (data[i] >= 254 && data[i + 1] >= 254 && data[i + 2] >= 254) continue; // cantos preenchidos ao endireitar
      lumHist[((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) | 0]++;
      n++;
    }
  }
  if (!n) return { cr: 1 / 3, cg: 1 / 3, lum: 255 };
  const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += lumHist[v]; if (acc >= n * p) return v; } return 255; };
  const mid = pct(0.5), lum = pct(0.9);
  const N = 60, lo = 0.2, span = 0.3; // proporções entre 0,20 e 0,50
  const hist = new Uint32Array(N * N);
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if ((r * 299 + g * 587 + b * 114) / 1000 < mid || (r >= 254 && g >= 254 && b >= 254)) continue;
      const s = r + g + b;
      const a = Math.floor(((r / s - lo) / span) * N), c = Math.floor(((g / s - lo) / span) * N);
      if (a >= 0 && a < N && c >= 0 && c < N) hist[a * N + c]++;
    }
  }
  let best = -1, ba = N / 2, bc = N / 2;
  for (let a = 1; a < N - 1; a++) {
    for (let c = 1; c < N - 1; c++) {
      let sum = 0;
      for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) sum += hist[(a + da) * N + c + dc];
      if (sum > best) { best = sum; ba = a; bc = c; }
    }
  }
  return { cr: lo + ((ba + 0.5) / N) * span, cg: lo + ((bc + 0.5) / N) * span, lum };
}

// Marca-texto claro (rosa, lilás, verde ou amarelo quase transparente): pixel claro cujo tom se afasta do
// tom do papel. Tons de pele e de madeira (alaranjado pouco saturado) continuam de fora.
const PALE_DIST = 0.016;
function isPale(r, g, b, paper) {
  if (r >= 254 && g >= 254 && b >= 254) return false;
  if ((r * 299 + g * 587 + b * 114) / 1000 < paper.lum * 0.55) return false; // tinta, sombra forte
  const s = r + g + b;
  const dr = r / s - paper.cr, dg = g / s - paper.cg;
  if (dr * dr + dg * dg < PALE_DIST * PALE_DIST) return false;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d >= 10) {
    const hh = hue(r, g, b, mx, d);
    if (hh >= 8 && hh < 45 && d / mx < 0.55) return false;
  }
  return true;
}

// Blocos com marca-texto colorido (forte ou claro)
function colorMask(img, B, gw, gh) {
  const { width: w, height: h, data } = img;
  const paper = paperColor(img);
  const count = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / B) | 0) * gw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isHighlight(data[i], data[i + 1], data[i + 2]) || isPale(data[i], data[i + 1], data[i + 2], paper)) count[row + ((x / B) | 0)]++;
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
// zoom: quanto a foto foi ampliada (letras ampliadas alternam menos vezes por pixel)
const looksLikeText = (t, zoom = 1) => t.dark > 0.04 && t.dark < 0.45 && t.flips * Math.max(1, zoom) > 0.022;

// Trechos grifados de um tipo: 'color' (marca-texto colorido) ou 'gray' (grifo cinza do Kindle)
function findPassages(img, kind = 'color', zoom = 1) {
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
  globalThis.__ocrTrace?.push(found.passages.map((p) => ({ kind, w, h, box: [p.x0, p.y0, p.x1, p.y1], big: bigEnough(p), ...textiness(img, p) }))); // inspeção em testes
  return { ...found, gray, passages: found.passages.filter((p) => bigEnough(p) && looksLikeText(textiness(img, p), zoom)) };
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

// Inclinação das linhas de texto, em graus (positivo = as linhas descem para a direita). Testa vários
// ângulos e fica com o que deixa as linhas mais separadas (faixas de tinta e de papel bem marcadas).
// Devolve 0 se a foto não tiver linhas de texto claras ou se a inclinação for desprezível.
export function estimateSkew(img, maxDeg = 25) {
  const { width: w, height: h, data } = img;
  const W = Math.min(480, w), k = w / W, H = Math.max(1, Math.round(h / k));
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.round(y * k));
    for (let x = 0; x < W; x++) {
      const i = (sy * w + Math.min(w - 1, Math.round(x * k))) * 4;
      g[y * W + x] = (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
  }
  // "tinta": mais escuro que a média da vizinhança (não depende da luz da foto)
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += g[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
  }
  const r = 6, xs = [], ys = [];
  for (let y = r; y < H - r; y++) {
    for (let x = r; x < W - r; x++) {
      const mean = (S[(y + r + 1) * (W + 1) + x + r + 1] - S[(y - r) * (W + 1) + x + r + 1] - S[(y + r + 1) * (W + 1) + x - r] + S[(y - r) * (W + 1) + x - r]) / ((2 * r + 1) ** 2);
      if (mean - g[y * W + x] > 12) { xs.push(x); ys.push(y); }
    }
  }
  if (xs.length < W * H * 0.01) return 0;
  const rows = new Float32Array(H * 3);
  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    rows.fill(0);
    for (let i = 0; i < xs.length; i++) rows[Math.round(ys[i] - xs[i] * t) + H]++;
    let v = 0;
    for (let j = 1; j < rows.length; j++) v += (rows[j] - rows[j - 1]) ** 2;
    return v;
  };
  const all = [];
  let best = 0, bestV = -1;
  for (let a = -maxDeg; a <= maxDeg; a++) { const v = score(a); all.push(v); if (v > bestV) { bestV = v; best = a; } }
  const typical = [...all].sort((p, q) => p - q)[all.length >> 1];
  if (bestV < typical * 1.5) return 0; // nenhum ângulo se destaca: não é uma página de texto
  let fine = best;
  for (let a = best - 0.75; a <= best + 0.75; a += 0.25) { const v = score(a); if (v > bestV) { bestV = v; fine = a; } }
  return Math.abs(fine) < 0.75 ? 0 : fine;
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
 * @returns {Promise<{text:string, regions:number, preview:string, size:number[]}>} size: largura e altura da foto original
 */
export async function runOCR(file, mode, onProgress = () => {}, { crop } = {}) {
  onProgress('Preparando imagem');
  // foto da câmera vem "deitada" com a rotação só no EXIF: aplica a rotação (senão o OCR lê o texto de lado)
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // só a área escolhida pela pessoa (o resto da foto nem entra na detecção)
  const sx = crop ? Math.round(crop.x0 * bmp.width) : 0, sy = crop ? Math.round(crop.y0 * bmp.height) : 0;
  const sw = crop ? Math.max(1, Math.round((crop.x1 - crop.x0) * bmp.width)) : bmp.width;
  const sh = crop ? Math.max(1, Math.round((crop.y1 - crop.y0) * bmp.height)) : bmp.height;
  // Fotos grandes são reduzidas; imagens pequenas (prints, fotos comprimidas por apps de mensagem, recortes)
  // são ampliadas, porque o OCR erra muito com letras de poucos pixels.
  const side = Math.max(sw, sh);
  const scale = side > MAX_SIDE ? MAX_SIDE / side : side < MIN_SIDE ? Math.min(4, MIN_SIDE / side) : 1;
  let w = Math.round(sw * scale), h = Math.round(sh * scale);
  let src = canvasOf(w, h);
  let sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  let img = sctx.getImageData(0, 0, w, h);

  // Página torta: endireita antes de procurar grifos e ler (o OCR só lê bem linhas horizontais).
  // A foto gira num quadro maior, para não cortar os cantos; o que sobra em volta fica branco.
  const angle = estimateSkew(img);
  if (angle) {
    const rad = (-angle * Math.PI) / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const nw = Math.round(w * cos + h * sin), nh = Math.round(w * sin + h * cos);
    const rot = canvasOf(nw, nh);
    const rctx = rot.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingQuality = 'high';
    rctx.translate(nw / 2, nh / 2);
    rctx.rotate(rad);
    rctx.drawImage(src, -w / 2, -h / 2);
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    const turned = rctx.getImageData(0, 0, nw, nh);
    for (let i = 0; i < turned.data.length; i += 4) {
      if (turned.data[i + 3] < 250) { turned.data[i] = turned.data[i + 1] = turned.data[i + 2] = 255; turned.data[i + 3] = 255; }
    }
    rctx.putImageData(turned, 0, 0);
    src = rot; sctx = rctx; img = turned; w = nw; h = nh;
  }

  // o motor de OCR só é carregado quando há o que ler (foto sem grifo não baixa nada)
  let worker = null;
  const setMode = async (psm) => { worker ||= await getWorker(); await worker.setParameters({ tessedit_pageseg_mode: psm }); };
  // grifo: cada recorte é um bloco de texto (modo 6); página inteira: detecção automática de colunas (modo 3)

  // Lê os recortes de uma imagem já preparada (out) e devolve o texto
  let confSum = 0, confN = 0; // confiança média da leitura (pesada pelo tamanho de cada trecho)
  async function read(out, boxes, gray) {
    const texts = [];
    try {
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        const pad = boxes.whole ? 0 : 10;
        const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
        const cw = Math.min(w, b.x1 + pad) - x0, ch = Math.min(h, b.y1 + pad) - y0;
        logger = (msg, p) => onProgress(boxes.length > 1 ? `${msg} (trecho ${k + 1}/${boxes.length})` : msg, p);
        // marca-texto colorido: a sombra da página escurece parte da faixa, e nenhum preto e branco serve para todas
        // as fotos; lê com o limite único e com o adaptativo suave e fica com a leitura de maior confiança
        const ways = boxes.whole ? [null] : gray ? ['gray'] : ['otsu', 'soft'];
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
        const t = cleanText(boxes.whole ? data.text : trimEdges(data, gray), boxes.whole);
        if (t) { texts.push(t); confSum += data.confidence * t.length; confN += t.length; }
      }
    } finally {
      logger = null;
    }
    return texts.join('\n\n');
  }

  // forAI: quando o aparelho achou os grifos, a foto para a leitura por IA leva só esses trechos (o resto
  // fica branco); assim a IA não tem como copiar o texto que não está grifado
  const result = (text, regions, boxes) => ({
    text, regions, preview: preview(src, w, h, boxes), size: [bmp.width, bmp.height], conf: confN ? Math.round(confSum / confN) : 0, angle,
    forAI: boxes.length ? () => jpegB64(onlyBoxes(src, w, h, boxes)) : null,
  });
  // Lê tudo o que está na imagem (página inteira, ou a área marcada quando não há grifo nela)
  async function readWhole() {
    await setMode('3');
    const out = canvasOf(w, h);
    const octx = out.getContext('2d');
    const proc = octx.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      proc.data[i] = proc.data[i + 1] = proc.data[i + 2] = v;
      proc.data[i + 3] = 255;
    }
    octx.putImageData(proc, 0, 0);
    const boxes = [{ x0: 0, y0: 0, x1: w, y1: h }];
    boxes.whole = true;
    return read(out, boxes, false);
  }
  if (mode === 'page') return result(await readWhole(), 0, []);

  // Grifos: primeiro marca-texto colorido; se não achar ou não sair texto, o grifo cinza do Kindle
  onProgress('Procurando grifos');
  let last = { passages: [] };
  for (const kind of ['color', 'gray']) {
    const found = findPassages(img, kind, scale);
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
    await setMode('6');
    const text = await read(out, passages, found.gray);
    if (text.replace(/[^\p{L}]/gu, '').length >= 8) return result(text, passages.length, passages);
    confSum = confN = 0;
  }
  // a pessoa marcou uma área e não há grifo nela: lê o que está na área
  if (crop) {
    const text = await readWhole();
    if (text.replace(/[^\p{L}]/gu, '').length >= 8) return result(text, 0, []);
  }
  return result('', last.passages.length, last.passages);
}

/** Cópia da imagem só com os retângulos dados (com uma folga); o resto fica branco. Lado maior até maxSide. */
export function onlyBoxes(source, w, h, boxes, maxSide = 1568) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = canvasOf(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  for (const b of boxes) {
    const pad = Math.max(6, Math.round((b.y1 - b.y0) * 0.06)); // folga pequena: não entra a linha de cima nem a de baixo
    const x0 = Math.max(0, b.x0 - pad * 2), y0 = Math.max(0, b.y0 - pad), x1 = Math.min(w, b.x1 + pad * 2), y1 = Math.min(h, b.y1 + pad);
    ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
  }
  return c;
}

async function jpegB64(c) {
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Foto pronta para a leitura por IA: só a área escolhida, com a rotação da câmera aplicada, reduzida
 * (lado maior de até maxSide) e em JPEG. Devolve o conteúdo em base64 (sem o prefixo "data:").
 */
export async function photoForAI(file, crop, maxSide = 1568) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const sx = crop ? Math.round(crop.x0 * bmp.width) : 0, sy = crop ? Math.round(crop.y0 * bmp.height) : 0;
  const sw = crop ? Math.max(1, Math.round((crop.x1 - crop.x0) * bmp.width)) : bmp.width;
  const sh = crop ? Math.max(1, Math.round((crop.y1 - crop.y0) * bmp.height)) : bmp.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = canvasOf(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return jpegB64(c);
}
