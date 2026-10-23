// Artes para Instagram desenhadas em <canvas>, no próprio aparelho (nada é enviado a servidor).
import { ymd, parseYmd, addDays, levelInfo } from './game.js';

export const SIZES = { story: [1080, 1920], feed: [1080, 1350] };
const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const PLUS_STYLES = ['noite', 'foto'];
export const prefs = { brand: true }; // Plus pode tirar a marca "Grifo" das artes
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------------- utilidades de desenho ----------------
export async function ensureFonts() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 48px Fraunces`), document.fonts.load(`600 48px Fraunces`),
        document.fonts.load(`italic 400 48px Fraunces`), document.fonts.load(`400 32px Inter`),
        document.fonts.load(`600 32px Inter`), document.fonts.load(`800 32px Inter`),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* sem internet: usa as fontes do sistema */ }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const hash = (s) => [...String(s || '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// Maior fonte em que o texto cabe na caixa; se nem a mínima couber, corta com reticências
function fitText(ctx, text, { maxW, maxH, max = 88, min = 30, font, lh = 1.32 }) {
  for (let s = max; s >= min; s -= 2) {
    ctx.font = font(s);
    const lines = wrap(ctx, text, maxW);
    if (lines.length * s * lh <= maxH) return { size: s, lines, lh: s * lh };
  }
  ctx.font = font(min);
  let lines = wrap(ctx, text, maxW);
  const maxLines = Math.max(1, Math.floor(maxH / (min * lh)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`;
  }
  return { size: min, lines, lh: min * lh };
}

function ellipsize(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function grain(ctx, w, h, alpha = 0.04) {
  for (let i = 0; i < (w * h) / 160; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 1.5})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

function linear(ctx, w, h, stops, angle = 'diag') {
  const g = angle === 'v' ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, h);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function brand(ctx, w, h, { dark = false, handle = '' } = {}) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = dark ? 'rgba(255,255,255,.72)' : 'rgba(45,47,54,.62)';
  ctx.font = `600 30px ${SANS}`;
  const label = prefs.brand ? `Grifo${handle ? `  ·  ${handle}` : ''}` : handle;
  if (label) ctx.fillText(label, w / 2, h - 70);
  ctx.restore();
}

function emoji(ctx, ch, x, y, size) {
  ctx.save();
  ctx.font = `${size}px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, x, y);
  ctx.restore();
}

function loadImage(src, timeout = 5000) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => resolve(null), timeout);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = src;
  });
}

function coverFit(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

// Capa: a imagem real se o servidor permitir, senão uma capa gerada bonita
async function drawCover(ctx, book, x, y, w, h, radius = 14) {
  const img = await loadImage(book.cover);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = '#ddd';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  if (img) {
    coverFit(ctx, img, x, y, w, h);
  } else {
    const hue = hash(book.title) % 360;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, `hsl(${hue} 50% 72%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360} 45% 58%)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(x + w * 0.06, y, w * 0.025, h);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const f = fitText(ctx, book.title, { maxW: w * 0.78, maxH: h * 0.5, max: Math.round(w / 6), min: 16, font: (s) => `600 ${s}px ${SERIF}` });
    let ty = y + h * 0.3;
    for (const l of f.lines) { ctx.fillText(l, x + w / 2, ty); ty += f.lh; }
    if (book.author) {
      ctx.font = `400 ${Math.round(w / 14)}px ${SANS}`;
      ctx.fillText(ellipsize(ctx, book.author, w * 0.8), x + w / 2, y + h * 0.88);
    }
  }
  ctx.restore();
}

function starsText(n) {
  return n > 0 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
}

// ---------------- 1. cartão de citação ----------------
export const QUOTE_STYLES = [
  { id: 'papel', label: '📜 Papel' },
  { id: 'grifo', label: '🖍️ Grifo' },
  { id: 'pastel', label: '🌸 Pastel' },
  { id: 'noite', label: '🌙 Noite' },
  { id: 'foto', label: '🖼️ Sua foto' },
];

const ART = {
  papel: { text: '#2b2620', sub: '#7a6e5d', accent: '#c08b5c', dark: false },
  grifo: { text: '#1f1f22', sub: '#6b6b72', accent: '#e0a21a', dark: false },
  pastel: { text: '#2d2f36', sub: '#6f7280', accent: '#6f7fe8', dark: false },
  noite: { text: '#eef0f6', sub: '#a3a7b5', accent: '#f0b590', dark: true },
  foto: { text: '#ffffff', sub: 'rgba(255,255,255,.8)', accent: '#ffd66b', dark: true },
};

function paintQuoteBg(ctx, w, h, style, photo) {
  if (style === 'papel') {
    ctx.fillStyle = '#f3ead8';
    ctx.fillRect(0, 0, w, h);
    const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(1, 'rgba(120,90,50,.18)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.05);
  } else if (style === 'grifo') {
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(111,127,232,.07)';
    ctx.lineWidth = 2;
    for (let y = 120; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(217,116,111,.25)';
    ctx.beginPath(); ctx.moveTo(90, 0); ctx.lineTo(90, h); ctx.stroke();
  } else if (style === 'pastel') {
    linear(ctx, w, h, ['#e7eafd', '#f4e9fb', '#fdeee4']);
  } else if (style === 'noite') {
    linear(ctx, w, h, ['#16171c', '#23263a', '#2e2a3a']);
    grain(ctx, w, h, 0.03);
  } else if (style === 'foto') {
    if (photo) {
      ctx.save();
      ctx.filter = 'blur(6px) saturate(1.1)';
      coverFit(ctx, photo, -20, -20, w + 40, h + 40);
      ctx.restore();
    } else {
      linear(ctx, w, h, ['#3a3f5c', '#5b4a63', '#7a5a52']);
    }
    linear(ctx, w, h, ['rgba(0,0,0,.35)', 'rgba(0,0,0,.6)'], 'v');
  }
}

export async function quoteCard({ text, title, author, page, style = 'papel', format = 'story', handle = '', photo = null }) {
  await ensureFonts();
  const [w, h] = SIZES[format];
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const t = ART[style] || ART.papel;
  paintQuoteBg(ctx, w, h, style, photo);

  const pad = style === 'grifo' ? 140 : 110;
  const top = format === 'story' ? 470 : 260;
  const boxH = format === 'story' ? 920 : 700;

  ctx.fillStyle = t.accent;
  ctx.font = `600 ${format === 'story' ? 280 : 220}px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText('“', pad - 16, top - 30);

  const fit = fitText(ctx, text, { maxW: w - pad * 2, maxH: boxH, max: format === 'story' ? 80 : 68, min: 32, font: (s) => `${style === 'grifo' ? 500 : 400} ${s}px ${SERIF}`, lh: style === 'grifo' ? 1.45 : 1.32 });
  let y = top + (boxH - fit.lines.length * fit.lh) / 2 + fit.size;
  for (const line of fit.lines) {
    if (style === 'grifo' && line) {
      // faixa de marca-texto levemente torta atrás de cada linha
      const lw = ctx.measureText(line).width;
      const r = hash(line);
      ctx.save();
      ctx.translate(pad - 10, y - fit.size * 0.78);
      ctx.rotate((((r % 7) - 3) / 3) * 0.006);
      ctx.fillStyle = 'rgba(255, 214, 64, .62)';
      ctx.beginPath();
      ctx.roundRect(0, 0, lw + 20, fit.size * 1.02, 8);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = t.text;
    ctx.fillText(line, pad, y);
    y += fit.lh;
  }

  y += 40;
  ctx.fillStyle = t.accent;
  ctx.fillRect(pad, y, 70, 5);
  y += 70;
  ctx.fillStyle = t.text;
  ctx.font = `600 40px ${SANS}`;
  ctx.fillText(ellipsize(ctx, title, w - pad * 2), pad, y);
  const meta = [author, page ? `p. ${page}` : ''].filter(Boolean).join('  ·  ');
  if (meta) {
    ctx.fillStyle = t.sub;
    ctx.font = `400 32px ${SANS}`;
    ctx.fillText(ellipsize(ctx, meta, w - pad * 2), pad, y + 52);
  }
  brand(ctx, w, h, { dark: t.dark, handle });
  return c;
}

// ---------------- 2. medalha / nível / sequência ----------------
export async function achievementCard({ icon, kicker, title, subtitle, foot, format = 'story', handle = '' }) {
  await ensureFonts();
  const [w, h] = SIZES[format];
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  linear(ctx, w, h, ['#fdf5e1', '#fbe7d6', '#efe3fb']);
  grain(ctx, w, h, 0.025);

  const cx = w / 2, cy = format === 'story' ? 780 : 560, R = format === 'story' ? 250 : 210;
  // fitas
  ctx.fillStyle = '#9ea9fb';
  ctx.beginPath(); ctx.moveTo(cx - 150, cy - R - 330); ctx.lineTo(cx - 40, cy - R - 330); ctx.lineTo(cx + 40, cy - R + 40); ctx.lineTo(cx - 70, cy - R + 40); ctx.fill();
  ctx.fillStyle = '#f3a37c';
  ctx.beginPath(); ctx.moveTo(cx + 150, cy - R - 330); ctx.lineTo(cx + 40, cy - R - 330); ctx.lineTo(cx - 40, cy - R + 40); ctx.lineTo(cx + 70, cy - R + 40); ctx.fill();
  // medalha
  ctx.save();
  ctx.shadowColor = 'rgba(160,110,20,.35)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, '#fff2bf');
  g.addColorStop(0.6, '#f2c95c');
  g.addColorStop(1, '#d69c2a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff8e3';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2); ctx.fill();
  emoji(ctx, icon, cx, cy + 8, R * 0.9);

  ctx.textAlign = 'center';
  let y = cy + R + 140;
  ctx.fillStyle = '#b07a1c';
  ctx.font = `800 34px ${SANS}`;
  ctx.fillText(kicker.toUpperCase().split('').join(String.fromCharCode(8202)), cx, y);
  y += 110;
  ctx.fillStyle = '#2d2f36';
  const f = fitText(ctx, title, { maxW: w - 200, maxH: 220, max: 96, min: 48, font: (s) => `600 ${s}px ${SERIF}`, lh: 1.15 });
  for (const l of f.lines) { ctx.fillText(l, cx, y); y += f.lh; }
  if (subtitle) {
    y += 10;
    ctx.fillStyle = '#5d606b';
    const s = fitText(ctx, subtitle, { maxW: w - 220, maxH: 160, max: 40, min: 28, font: (z) => `400 ${z}px ${SANS}` });
    for (const l of s.lines) { ctx.fillText(l, cx, y); y += s.lh; }
  }
  if (foot) {
    ctx.fillStyle = '#9a8f80';
    ctx.font = `400 30px ${SANS}`;
    ctx.fillText(foot, cx, h - 150);
  }
  brand(ctx, w, h, { handle });
  return c;
}

// ---------------- 3. lendo agora / terminei ----------------
export async function readingCard({ book, streak = 0, format = 'story', handle = '' }) {
  await ensureFonts();
  const [w, h] = SIZES[format];
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const hue = hash(book.title) % 360;
  linear(ctx, w, h, [`hsl(${hue} 60% 93%)`, `hsl(${(hue + 50) % 360} 55% 90%)`]);
  grain(ctx, w, h, 0.02);

  const done = book.status === 'finished';
  const story = format === 'story';
  ctx.textAlign = 'center';
  ctx.fillStyle = `hsl(${hue} 35% 35%)`;
  ctx.font = `800 36px ${SANS}`;
  ctx.fillText(done ? 'TERMINEI DE LER' : 'LENDO AGORA', w / 2, story ? 230 : 140);

  const cw = story ? 520 : 400, ch = cw * 1.5;
  const cy = story ? 300 : 190;
  await drawCover(ctx, book, (w - cw) / 2, cy, cw, ch, 18);

  let y = cy + ch + (story ? 130 : 95);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#2d2f36';
  const tf = fitText(ctx, book.title, { maxW: w - 180, maxH: story ? 190 : 120, max: story ? 70 : 56, min: 36, font: (s) => `600 ${s}px ${SERIF}`, lh: 1.15 });
  for (const l of tf.lines) { ctx.fillText(l, w / 2, y); y += tf.lh; }
  ctx.fillStyle = '#6f7280';
  ctx.font = `400 36px ${SANS}`;
  ctx.fillText(ellipsize(ctx, book.author || '', w - 200), w / 2, y + 6);
  y += story ? 100 : 70;

  if (done) {
    if (book.rating) {
      ctx.fillStyle = '#e2a93b';
      ctx.font = `400 64px ${SANS}`;
      ctx.fillText(starsText(book.rating), w / 2, y);
    }
  } else if (book.pages) {
    const pct = Math.min(1, (book.currentPage || 0) / book.pages);
    const bw = w - 300, bx = 150;
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.roundRect(bx, y - 22, bw, 30, 15); ctx.fill();
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#6f7fe8');
    g.addColorStop(1, '#f3a37c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(bx, y - 22, Math.max(30, bw * pct), 30, 15); ctx.fill();
    ctx.fillStyle = '#2d2f36';
    ctx.font = `600 34px ${SANS}`;
    ctx.fillText(`${Math.round(pct * 100)}%  ·  pág. ${book.currentPage || 0} de ${book.pages}`, w / 2, y + 70);
  }
  if (streak > 1) {
    ctx.font = `600 34px ${SANS}`;
    const label = `🔥 ${streak} dias seguidos lendo`;
    const lw = ctx.measureText(label).width + 60;
    const py = story ? h - 230 : h - 170;
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.roundRect((w - lw) / 2, py - 50, lw, 74, 37); ctx.fill();
    ctx.fillStyle = '#2d2f36';
    ctx.fillText(label, w / 2, py);
  }
  brand(ctx, w, h, { handle });
  return c;
}

// ---------------- 4. estante: prateleira e mosaico ----------------
export const SHELF_STYLES = [
  { id: 'shelf', label: '📚 Prateleira' },
  { id: 'mosaic', label: '🧩 Mosaico de capas' },
];

export async function shelfCard({ books, heading, subheading, style = 'shelf', format = 'story', handle = '' }) {
  await ensureFonts();
  const [w, h] = SIZES[format];
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const story = format === 'story';

  if (style === 'mosaic') linear(ctx, w, h, ['#1d1f27', '#272a3a']);
  else { linear(ctx, w, h, ['#f6f0e6', '#efe6d8'], 'v'); grain(ctx, w, h, 0.03); }
  const dark = style === 'mosaic';

  ctx.textAlign = 'center';
  ctx.fillStyle = dark ? '#eef0f6' : '#2d2f36';
  ctx.font = `600 ${story ? 84 : 70}px ${SERIF}`;
  ctx.fillText(heading, w / 2, story ? 230 : 150);
  ctx.fillStyle = dark ? '#a3a7b5' : '#7a6e5d';
  ctx.font = `400 36px ${SANS}`;
  ctx.fillText(subheading, w / 2, story ? 300 : 210);

  const top = story ? 380 : 270, bottom = h - 150, side = 70;
  if (!books.length) {
    ctx.fillText('Nenhum livro concluído nesse período.', w / 2, (top + bottom) / 2);
  } else if (style === 'mosaic') {
    const n = books.length;
    const areaW = w - side * 2, areaH = bottom - top;
    let cols = 1;
    while (cols < n && Math.ceil(n / cols) * ((areaW / cols) * 1.5 + 16) > areaH) cols++;
    const gap = 16, cw = (areaW - gap * (cols - 1)) / cols, ch = cw * 1.5;
    const rows = Math.ceil(n / cols);
    const y0 = top + (areaH - rows * ch - (rows - 1) * gap) / 2;
    await Promise.all(books.map((b, i) => {
      const r = Math.floor(i / cols), col = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const x0 = side + (areaW - inRow * cw - (inRow - 1) * gap) / 2;
      return drawCover(ctx, b, x0 + col * (cw + gap), y0 + r * (ch + gap), cw, ch, Math.max(6, cw / 20));
    }));
  } else {
    // lombadas em prateleiras de madeira: largura pela espessura do livro, ampliadas para preencher a prateleira
    const innerW = w - side * 2, gap = 6, rowGap = 70;
    const natural = books.map((b) => Math.max(36, Math.min(96, (b.pages || 250) / 7)));
    const totalW = natural.reduce((a, x) => a + x + gap, 0);
    const baseH = story ? 380 : 300;
    const rowsMax = Math.max(1, Math.floor((bottom - top + rowGap) / (baseH + rowGap)));
    const rowsWanted = Math.min(rowsMax, Math.ceil(totalW / innerW));
    const scale = Math.min(2.4, Math.max(0.55, (innerW * rowsWanted * 0.9) / totalW));
    const shelfH = Math.min(baseH * (scale > 1.5 ? 1.35 : 1), (bottom - top - (rowsWanted - 1) * rowGap) / rowsWanted);

    const rows = [[]];
    let used = 0, drawn = 0;
    for (let i = 0; i < books.length; i++) {
      const bw = natural[i] * scale;
      if (used + bw > innerW && rows[rows.length - 1].length) {
        if (rows.length >= rowsMax) break;
        rows.push([]);
        used = 0;
      }
      rows[rows.length - 1].push({ b: books[i], bw });
      used += bw + gap;
      drawn++;
    }
    const blockH = rows.length * shelfH + (rows.length - 1) * rowGap;
    const y0 = top + (bottom - top - blockH) / 2;
    rows.forEach((row, r) => {
      const base = y0 + r * (shelfH + rowGap) + shelfH;
      const rowW = row.reduce((a, s) => a + s.bw + gap, -gap);
      let x = (w - rowW) / 2;
      for (const { b, bw } of row) {
        const bh = shelfH * (0.74 + (hash(b.title) % 24) / 100);
        const hue = hash(b.title + b.author) % 360;
        ctx.fillStyle = `hsl(${hue} 42% ${58 + (hash(b.title) % 18)}%)`;
        ctx.beginPath(); ctx.roundRect(x, base - bh, bw, bh, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillRect(x, base - bh + 24, bw, 6);
        ctx.fillRect(x, base - 36, bw, 6);
        ctx.save();
        ctx.translate(x + bw / 2, base - 52);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.font = `600 ${Math.round(Math.min(34, bw * 0.4))}px ${SANS}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ellipsize(ctx, b.title, bh - 100), 0, 0);
        ctx.restore();
        x += bw + gap;
      }
      const g = ctx.createLinearGradient(0, base, 0, base + 30);
      g.addColorStop(0, '#b98b60');
      g.addColorStop(1, '#8a6440');
      ctx.fillStyle = g;
      ctx.fillRect(side - 30, base, w - (side - 30) * 2, 26);
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      ctx.fillRect(side - 30, base + 26, w - (side - 30) * 2, 14);
    });
    if (drawn < books.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7a6e5d';
      ctx.font = `600 34px ${SANS}`;
      ctx.fillText(`+ ${books.length - drawn} livros`, w / 2, bottom - 10);
    }
  }
  brand(ctx, w, h, { dark, handle });
  return c;
}

// ---------------- 5. retrospectiva (Wrapped) ----------------
export const PERIODS = [
  { id: 'month', label: 'Este mês' },
  { id: 'lastMonth', label: 'Mês passado' },
  { id: 'year', label: 'Este ano' },
];

function periodRange(id) {
  const now = new Date();
  if (id === 'year') return { start: `${now.getFullYear()}-01-01`, end: ymd(now), label: String(now.getFullYear()), long: `de ${now.getFullYear()}` };
  const d = id === 'lastMonth' ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const last = id === 'lastMonth' ? new Date(now.getFullYear(), now.getMonth(), 0) : now;
  return { start: ymd(d), end: ymd(last), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, long: `de ${MONTHS[d.getMonth()]}` };
}

export function wrappedData(state, periodId) {
  const r = periodRange(periodId);
  const inR = (s) => s && s >= r.start && s <= r.end;
  const tsStart = parseYmd(r.start).getTime(), tsEnd = parseYmd(r.end).getTime() + 864e5;
  const sessions = state.sessions.filter((s) => inR(s.date) && s.pages > 0);
  const finished = state.books.filter((b) => b.status === 'finished' && inR(b.endDate));
  const notes = state.notes.filter((n) => n.createdAt >= tsStart && n.createdAt < tsEnd);
  const reviews = (state.reviews || []).filter((x) => inR(x.date));
  const cards = (state.cards || []).filter((x) => x.createdAt >= tsStart && x.createdAt < tsEnd);

  const allSess = new Map();
  for (const s of state.sessions) allSess.set(s.bookId, (allSess.get(s.bookId) || 0) + (s.pages || 0));
  let pages = sessions.reduce((a, s) => a + s.pages, 0);
  for (const b of finished) pages += Math.max(0, (b.pages || 0) - (allSess.get(b.id) || 0));

  const byDay = new Map();
  for (const s of sessions) byDay.set(s.date, (byDay.get(s.date) || 0) + s.pages);
  let longest = 0, run = 0, prev = null, bestDay = 0, bestDate = null;
  for (const d of [...byDay.keys()].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
    if (byDay.get(d) > bestDay) { bestDay = byDay.get(d); bestDate = d; }
  }
  const mins = sessions.filter((s) => s.minutes > 0);
  const speed = mins.length ? mins.reduce((a, s) => a + s.pages, 0) / mins.reduce((a, s) => a + s.minutes, 0) : 0;

  const count = (arr, key) => {
    const m = new Map();
    for (const x of arr) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const touched = finished.length ? finished : state.books.filter((b) => sessions.some((s) => s.bookId === b.id));
  const themes = count(touched, (b) => b.genre);
  const subthemes = count(touched, (b) => b.subtheme);
  const purposes = { hobby: 0, professional: 0, academic: 0 };
  for (const b of touched) purposes[b.purpose || 'hobby']++;

  const notesOf = (id) => state.notes.filter((n) => n.bookId === id).length;
  const best = [...finished].sort((a, b) => (b.rating || 0) - (a.rating || 0) || notesOf(b.id) - notesOf(a.id))[0];

  const linkCount = (n) => (n.text.match(/\[\[[^\]]+\]\]/g) || []).length;
  const plain = (t) => t.replace(/\[\[([^[\]]+?)\]\]/g, (m, x) => x.split('|').pop());
  const quoteNote = [...notes]
    .filter((n) => plain(n.text).length >= 30 && plain(n.text).length <= 280)
    .sort((a, b) => (b.kind === 'quote') - (a.kind === 'quote')
      || (state.cards || []).filter((c) => c.noteId === b.id).length - (state.cards || []).filter((c) => c.noteId === a.id).length
      || linkCount(b) - linkCount(a))[0];
  const linked = notes.filter((n) => linkCount(n) > 0).length;
  const connections = notes.reduce((a, n) => a + linkCount(n), 0);

  // perfil de leitor
  const total = touched.length || 1;
  const fiction = touched.filter((b) => /literatura|romance|fantasia|ficção|poesia|clássico|conto/i.test(`${b.genre} ${b.subtheme}`)).length;
  const study = (purposes.professional + purposes.academic) / total;
  let persona;
  if (reviews.length >= 50) persona = { icon: '🧠', name: 'Guardião da Memória', desc: `Você não só lê: você lembra. Foram ${reviews.length} revisões de cards.` };
  else if (study >= 0.5 && notes.length && linked / notes.length >= 0.3) persona = { icon: '🏛️', name: 'Arquiteto de Ideias', desc: 'Você conecta conceitos entre livros como quem constrói um sistema.' };
  else if (purposes.academic / total >= 0.4) persona = { icon: '🎓', name: 'Mente Acadêmica', desc: 'Estudo é seu combustível. Cada livro vira degrau.' };
  else if (purposes.professional / total >= 0.4) persona = { icon: '💼', name: 'Construtor de Carreira', desc: 'Você lê para crescer — e cada página vira resultado.' };
  else if (fiction / total >= 0.5 || purposes.hobby / total >= 0.7) persona = { icon: '🌌', name: 'Viajante de Mundos', desc: 'Histórias são sua porta para outras vidas e lugares.' };
  else if (longest >= 14) persona = { icon: '🔥', name: 'Leitor Constante', desc: `Disciplina pura: ${longest} dias seguidos de leitura.` };
  else persona = { icon: '🧭', name: 'Explorador Curioso', desc: 'Você passeia entre temas e encontra ideias onde ninguém procura.' };

  return {
    range: r, pages, finished, sessions, days: byDay.size, longest, bestDay, bestDate, speed,
    themes, subthemes, purposes, best, quote: quoteNote && { ...quoteNote, text: plain(quoteNote.text) },
    notes: notes.length, linked, connections, cards: cards.length, reviews: reviews.length, persona,
    empty: !pages && !finished.length && !notes.length,
  };
}

const SLIDE_BG = [
  ['#e7eafd', '#f4e9fb'], ['#fdeee4', '#fbe3e9'], ['#e3f4ee', '#e7eafd'], ['#fff3d6', '#fde4d3'],
  ['#efe3fb', '#e3eefb'], ['#fbe3e9', '#fff3d6'], ['#16171c', '#2e2a3a'], ['#e3eefb', '#e3f4ee'],
];

function slideFrame(ctx, w, h, i, n, d, dark = false) {
  linear(ctx, w, h, dark ? ['#16171c', '#23263a', '#2e2a3a'] : SLIDE_BG[i % SLIDE_BG.length]);
  grain(ctx, w, h, dark ? 0.03 : 0.02);
  ctx.textAlign = 'center';
  ctx.fillStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(45,47,54,.55)';
  ctx.font = `800 28px ${SANS}`;
  ctx.fillText(`RETROSPECTIVA · ${d.range.label.toUpperCase()}`, w / 2, 130);
  const dotW = 22, gap = 10, total = n * dotW + (n - 1) * gap;
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = k === i ? (dark ? '#fff' : '#2d2f36') : (dark ? 'rgba(255,255,255,.25)' : 'rgba(45,47,54,.2)');
    ctx.beginPath(); ctx.roundRect(w / 2 - total / 2 + k * (dotW + gap), 60, dotW, 8, 4); ctx.fill();
  }
}

function bigNumber(ctx, value, x, y, size, color = '#2d2f36') {
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px ${SANS}`;
  ctx.fillText(Number(value).toLocaleString('pt-BR'), x, y);
}

function centerLines(ctx, text, y, { maxW, maxH, max, min, font, color, lh }) {
  ctx.fillStyle = color;
  const f = fitText(ctx, text, { maxW, maxH, max, min, font, lh });
  for (const l of f.lines) { ctx.fillText(l, ctx.canvas.width / 2, y); y += f.lh; }
  return y;
}

export async function wrappedSlides(state, { period = 'month', name = '', handle = '', xp = 0 } = {}) {
  await ensureFonts();
  const d = wrappedData(state, period);
  const [w, h] = SIZES.story;
  const ink = '#2d2f36', soft = '#6f7280';
  const slides = [];

  slides.push(async (ctx, i, n) => {
    slideFrame(ctx, w, h, i, n, d);
    emoji(ctx, '📚', w / 2, 620, 220);
    ctx.fillStyle = soft;
    ctx.font = `400 44px ${SANS}`;
    ctx.fillText(name ? `${name}, esta é a sua` : 'Esta é a sua', w / 2, 880);
    centerLines(ctx, 'retrospectiva de leituras', 990, { maxW: w - 200, maxH: 260, max: 100, min: 60, font: (s) => `600 ${s}px ${SERIF}`, color: ink, lh: 1.1 });
    ctx.fillStyle = '#6f7fe8';
    ctx.font = `800 120px ${SANS}`;
    ctx.fillText(d.range.label, w / 2, 1330);
    if (d.empty) {
      ctx.fillStyle = soft;
      ctx.font = `400 38px ${SANS}`;
      ctx.fillText('Ainda sem leituras registradas nesse período.', w / 2, 1520);
    }
  });

  if (d.pages) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      ctx.fillStyle = soft;
      ctx.font = `400 46px ${SANS}`;
      ctx.fillText(`Você leu ${d.range.long}`, w / 2, 560);
      bigNumber(ctx, d.pages, w / 2, 800, 230, '#6f7fe8');
      centerLines(ctx, 'páginas', 900, { maxW: w - 200, maxH: 120, max: 80, min: 60, font: (s) => `600 ${s}px ${SERIF}`, color: ink });
      const facts = [
        `≈ ${Math.max(1, Math.round(d.pages / 96))}× O Pequeno Príncipe inteiro`,
        `uma pilha de papel de ${(d.pages * 0.005).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm`,
      ];
      if (d.speed) facts.push(`≈ ${Math.round(d.pages / d.speed / 60)} horas de leitura`);
      let y = 1150;
      for (const f of facts) {
        ctx.font = `600 40px ${SANS}`;
        const tw = ctx.measureText(f).width + 80;
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.beginPath(); ctx.roundRect((w - tw) / 2, y - 58, tw, 86, 43); ctx.fill();
        ctx.fillStyle = ink;
        ctx.fillText(f, w / 2, y);
        y += 120;
      }
    });
  }

  if (d.finished.length) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      bigNumber(ctx, d.finished.length, w / 2, 560, 260, '#f08a5d');
      centerLines(ctx, d.finished.length === 1 ? 'livro concluído' : 'livros concluídos', 680, { maxW: w - 200, maxH: 120, max: 80, min: 50, font: (s) => `600 ${s}px ${SERIF}`, color: ink });
      const list = d.finished.slice(0, 12);
      const cols = list.length <= 2 ? list.length : list.length <= 6 ? 3 : 4;
      const gap = 24, cw = Math.min(300, (w - 160 - gap * (cols - 1)) / cols), ch = cw * 1.5;
      const rows = Math.ceil(list.length / cols);
      const y0 = 800 + (1000 - rows * ch - (rows - 1) * gap) / 2;
      await Promise.all(list.map((b, k) => {
        const r = Math.floor(k / cols), col = k % cols;
        const inRow = Math.min(cols, list.length - r * cols);
        const x0 = (w - inRow * cw - (inRow - 1) * gap) / 2;
        return drawCover(ctx, b, x0 + col * (cw + gap), y0 + r * (ch + gap), cw, ch, 12);
      }));
      if (d.finished.length > list.length) {
        ctx.fillStyle = soft;
        ctx.font = `600 36px ${SANS}`;
        ctx.fillText(`+ ${d.finished.length - list.length} livros`, w / 2, h - 190);
      }
    });
  }

  if (d.best) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      ctx.fillStyle = soft;
      ctx.font = `800 34px ${SANS}`;
      ctx.fillText(period === 'year' ? 'SEU LIVRO DO ANO' : 'SEU LIVRO DO MÊS', w / 2, 300);
      await drawCover(ctx, d.best, (w - 480) / 2, 380, 480, 720, 18);
      let y = centerLines(ctx, d.best.title, 1250, { maxW: w - 180, maxH: 200, max: 72, min: 40, font: (s) => `600 ${s}px ${SERIF}`, color: ink, lh: 1.15 });
      ctx.fillStyle = soft;
      ctx.font = `400 38px ${SANS}`;
      ctx.fillText(d.best.author || '', w / 2, y + 10);
      if (d.best.rating) {
        ctx.fillStyle = '#e2a93b';
        ctx.font = `400 70px ${SANS}`;
        ctx.fillText(starsText(d.best.rating), w / 2, y + 120);
      }
    });
  }

  if (d.themes.length || d.subthemes.length) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      ctx.fillStyle = soft;
      ctx.font = `400 46px ${SANS}`;
      ctx.fillText('Seu assunto preferido foi', w / 2, 500);
      let y = centerLines(ctx, (d.themes[0] || d.subthemes[0])[0], 660, { maxW: w - 160, maxH: 260, max: 120, min: 60, font: (s) => `600 ${s}px ${SERIF}`, color: '#8a63d2', lh: 1.1 });
      if (d.subthemes[0]) {
        ctx.fillStyle = ink;
        ctx.font = `400 42px ${SANS}`;
        ctx.fillText(`com destaque para ${d.subthemes[0][0]}`, w / 2, y + 20);
      }
      const tot = Object.values(d.purposes).reduce((a, b) => a + b, 0) || 1;
      const rows = [['🎈 Hobby', d.purposes.hobby, '#f3a37c'], ['💼 Profissional', d.purposes.professional, '#7b8cf0'], ['🎓 Acadêmico', d.purposes.academic, '#5fb49c']];
      y = 1100;
      for (const [label, v, color] of rows) {
        const pct = v / tot;
        ctx.textAlign = 'left';
        ctx.fillStyle = ink;
        ctx.font = `600 40px ${SANS}`;
        ctx.fillText(label, 140, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(pct * 100)}%`, w - 140, y);
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.beginPath(); ctx.roundRect(140, y + 26, w - 280, 30, 15); ctx.fill();
        ctx.fillStyle = color;
        if (pct > 0) { ctx.beginPath(); ctx.roundRect(140, y + 26, Math.max(30, (w - 280) * pct), 30, 15); ctx.fill(); }
        ctx.textAlign = 'center';
        y += 160;
      }
    });
  }

  if (d.days) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      centerLines(ctx, 'Seu hábito de leitura', 420, { maxW: w - 200, maxH: 200, max: 80, min: 50, font: (s) => `600 ${s}px ${SERIF}`, color: ink });
      const tiles = [
        ['📅', d.days, d.days === 1 ? 'dia lendo' : 'dias lendo'],
        ['🔥', d.longest, 'dias seguidos (recorde)'],
        ['🏃', d.bestDay, 'páginas no melhor dia'],
        ['⏱️', d.speed ? Math.round(d.speed * 60) : '—', 'páginas por hora'],
      ];
      const tw = 400, th = 380, gx = 40;
      tiles.forEach(([ic, v, label], k) => {
        const x = w / 2 - tw - gx / 2 + (k % 2) * (tw + gx);
        const y = 620 + Math.floor(k / 2) * (th + 40);
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        ctx.beginPath(); ctx.roundRect(x, y, tw, th, 36); ctx.fill();
        emoji(ctx, ic, x + tw / 2, y + 90, 80);
        ctx.fillStyle = ink;
        ctx.font = `800 110px ${SANS}`;
        ctx.fillText(typeof v === 'number' ? v.toLocaleString('pt-BR') : v, x + tw / 2, y + 255);
        ctx.fillStyle = soft;
        ctx.font = `400 30px ${SANS}`;
        ctx.fillText(label, x + tw / 2, y + 320);
      });
    });
  }

  if (d.quote) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d, true);
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.font = `800 32px ${SANS}`;
      ctx.fillText('O TRECHO QUE FICOU', w / 2, 330);
      ctx.fillStyle = '#f0b590';
      ctx.font = `600 260px ${SERIF}`;
      ctx.fillText('“', w / 2, 600);
      const y = centerLines(ctx, d.quote.text, 760, { maxW: w - 200, maxH: 760, max: 72, min: 36, font: (s) => `italic 400 ${s}px ${SERIF}`, color: '#eef0f6', lh: 1.35 });
      const b = state.books.find((x) => x.id === d.quote.bookId);
      ctx.fillStyle = '#a3a7b5';
      ctx.font = `600 36px ${SANS}`;
      ctx.fillText(ellipsize(ctx, `— ${b?.title || ''}`, w - 200), w / 2, y + 60);
      return true;
    });
  }

  if (d.notes || d.cards || d.reviews) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      centerLines(ctx, 'Seu segundo cérebro cresceu', 420, { maxW: w - 200, maxH: 240, max: 84, min: 50, font: (s) => `600 ${s}px ${SERIF}`, color: ink, lh: 1.15 });
      const rows = [
        ['✍️', d.notes, 'notas escritas'],
        ['🔗', d.connections, 'conexões entre ideias'],
        ['🧠', d.cards, 'cards criados'],
        ['🔁', d.reviews, 'revisões feitas'],
      ];
      let y = 760;
      for (const [ic, v, label] of rows) {
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        ctx.beginPath(); ctx.roundRect(140, y - 100, w - 280, 170, 34); ctx.fill();
        emoji(ctx, ic, 240, y - 15, 76);
        ctx.textAlign = 'left';
        ctx.fillStyle = ink;
        ctx.font = `800 84px ${SANS}`;
        const num = v.toLocaleString('pt-BR');
        ctx.fillText(num, 330, y + 15);
        const nw = ctx.measureText(num).width;
        ctx.fillStyle = soft;
        ctx.font = `400 36px ${SANS}`;
        ctx.fillText(label, 330 + nw + 24, y + 5);
        ctx.textAlign = 'center';
        y += 210;
      }
    });
  }

  if (!d.empty) {
    slides.push(async (ctx, i, n) => {
      slideFrame(ctx, w, h, i, n, d);
      ctx.fillStyle = soft;
      ctx.font = `400 46px ${SANS}`;
      ctx.fillText('Seu perfil de leitor é', w / 2, 460);
      emoji(ctx, d.persona.icon, w / 2, 740, 260);
      const y = centerLines(ctx, d.persona.name, 1060, { maxW: w - 160, maxH: 260, max: 110, min: 60, font: (s) => `600 ${s}px ${SERIF}`, color: '#6f7fe8', lh: 1.08 });
      centerLines(ctx, d.persona.desc, y + 60, { maxW: w - 240, maxH: 260, max: 46, min: 32, font: (s) => `400 ${s}px ${SANS}`, color: ink, lh: 1.4 });
    });
  }

  const lv = levelInfo(xp);
  slides.push(async (ctx, i, n) => {
    slideFrame(ctx, w, h, i, n, d, true);
    emoji(ctx, '⭐', w / 2, 620, 200);
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.font = `400 44px ${SANS}`;
    ctx.fillText('Você está no', w / 2, 860);
    centerLines(ctx, `Nível ${lv.level} · ${lv.title}`, 990, { maxW: w - 160, maxH: 260, max: 90, min: 50, font: (s) => `600 ${s}px ${SERIF}`, color: '#ffffff', lh: 1.12 });
    ctx.fillStyle = '#f0b590';
    ctx.font = `800 64px ${SANS}`;
    ctx.fillText(`${xp.toLocaleString('pt-BR')} XP`, w / 2, 1280);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = `italic 400 48px ${SERIF}`;
    ctx.fillText('Que venha o próximo capítulo.', w / 2, 1500);
    return true;
  });

  const out = [];
  for (let i = 0; i < slides.length; i++) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const dark = await slides[i](ctx, i, slides.length);
    brand(ctx, w, h, { dark: !!dark, handle });
    out.push(c);
  }
  return out;
}
