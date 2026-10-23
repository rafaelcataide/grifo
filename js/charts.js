// Gráficos leves em SVG/HTML, sem bibliotecas externas.
import { LOCALE, tr } from './i18n.js';
import { ymd, parseYmd } from './game.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(Math.round(n)));

export function ring(ratio, size = 84) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const raw = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  const p = Math.min(1, raw);
  return `<svg class="ring ${p >= 1 ? 'full' : ''}" viewBox="0 0 84 84" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="42" cy="42" r="${r}" class="ring-bg"/>
    <circle cx="42" cy="42" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}" transform="rotate(-90 42 42)"/>
    <text x="42" y="47" text-anchor="middle" class="ring-txt">${p >= 1 ? '✓' : `${Math.round(raw * 100)}%`}</text>
  </svg>`;
}

export function bars(items, { height = 140, unit = '' } = {}) {
  const W = 320, H = height, n = items.length || 1;
  const max = Math.max(1, ...items.map((i) => i.value));
  const bw = W / n;
  const body = items.map((it, i) => {
    const h = Math.round((it.value / max) * (H - 18));
    const w = bw * 0.68;
    const x = i * bw + (bw - w) / 2;
    return `<g><title>${esc(it.label)}: ${it.value}${unit}</title>
      <rect x="${x.toFixed(1)}" y="${H - h}" width="${w.toFixed(1)}" height="${it.value ? Math.max(h, 2) : 0}" rx="3" class="bar-fg ${it.highlight ? 'hl' : ''}"/>
      ${it.value ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - h - 4}" text-anchor="middle" class="bar-val">${short(it.value)}</text>` : ''}
      <text x="${(x + w / 2).toFixed(1)}" y="${H + 14}" text-anchor="middle" class="bar-lbl">${esc(it.label)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 20}" role="img"><line x1="0" x2="${W}" y1="${H}" y2="${H}" class="axis"/>${body}</svg>`;
}

// Mapa de calor estilo GitHub: colunas = semanas, linhas = seg..dom
export function heatmap(dayMap, weeks = 18) {
  const cs = 13, g = 3, left = 26, top = 16;
  const todayStr = ymd();
  const today = parseYmd(todayStr);
  const dow = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(start.getDate() - dow - (weeks - 1) * 7);
  let cells = '', labels = '', lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + d);
      if (dt > today) continue;
      const key = ymd(dt);
      const v = dayMap.get(key) || 0;
      const lvl = v === 0 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4;
      const x = left + w * (cs + g), y = top + d * (cs + g);
      cells += `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" rx="3" class="hm h${lvl}${key === todayStr ? ' today' : ''}"><title>${dt.toLocaleDateString(LOCALE)}: ${v} pág.</title></rect>`;
      if (d === 0 && dt.getMonth() !== lastMonth) {
        lastMonth = dt.getMonth();
        labels += `<text x="${x}" y="10" class="bar-lbl">${dt.toLocaleDateString(LOCALE, { month: 'short' }).replace('.', '')}</text>`;
      }
    }
  }
  const dayLbl = [['seg', 0], ['qua', 2], ['sex', 4]]
    .map(([t, r]) => `<text x="0" y="${top + r * (cs + g) + 10}" class="bar-lbl">${t}</text>`).join('');
  const W = left + weeks * (cs + g), H = top + 7 * (cs + g);
  return `<svg class="chart heat" viewBox="0 0 ${W} ${H}" role="img">${labels}${dayLbl}${cells}</svg>
    <div class="legend small muted">menos <i class="hm-l h0"></i><i class="hm-l h1"></i><i class="hm-l h2"></i><i class="hm-l h3"></i><i class="hm-l h4"></i> mais</div>`;
}

export function hbars(items, { unit = '' } = {}) {
  if (!items.length) return '<p class="muted small">Sem dados ainda.</p>';
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items.map((it) => `
    <div class="hbar"><span class="hbar-lbl">${esc(it.label)}</span>
      <span class="hbar-track"><span style="width:${(it.value / max) * 100}%"></span></span>
      <b>${it.value}${unit}</b></div>`).join('')}</div>`;
}
