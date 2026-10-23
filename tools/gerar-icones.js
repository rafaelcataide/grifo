// Gera os ícones PNG do PWA (192 e 512) sem dependências externas.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel((x + 0.5) / size, (y + 0.5) / size, 1 / size);
      const o = y * row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Mesmo desenho do icon.svg (linhas de texto com uma delas grifada), em coordenadas de 0 a 512.
// Fundo sangrado para ícone "maskable"; cada pixel é amostrado 4×4 vezes para bordas suaves.
const BG = [111, 127, 232], WHITE = [255, 255, 255], YELLOW = [255, 214, 107], INK = [59, 63, 143];
const BAND = [[84, 228], [428, 214], [434, 300], [90, 314]];

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// retângulo de cantos totalmente arredondados (uma "linha de texto")
function inPill(x, y, x0, y0, w, h) {
  const r = h / 2;
  if (y < y0 || y > y0 + h || x < x0 || x > x0 + w) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  return Math.hypot(x - cx, y - (y0 + r)) <= r;
}

function shape(x, y) {
  if (inPill(x, y, 106, 244, 300, 36)) return INK;
  if (inPill(x, y, 106, 150, 300, 36) || inPill(x, y, 106, 338, 210, 36)) return WHITE;
  if (inPolygon(x, y, BAND)) return YELLOW;
  return BG;
}

function pixel(u, v, step) {
  const acc = [0, 0, 0];
  const n = 4;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = shape((u + ((i + 0.5) / n - 0.5) * step) * 512, (v + ((j + 0.5) / n - 0.5) * step) * 512);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
  }
  return acc.map((c) => Math.round(c / (n * n)));
}

const out = path.join(__dirname, '..', 'icons');
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size, pixel));
  console.log(`icons/icon-${size}.png`);
}
