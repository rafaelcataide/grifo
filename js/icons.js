// Ícones da interface (Tabler Icons, traço fino). O app é escrito com emojis nos rótulos ("📖 Registrar leitura");
// ao aparecer na tela, o emoji de botões, abas, títulos e rótulos vira o ícone correspondente.
// Avisos, medalhas, ranking e artes do Instagram mantêm os emojis (são comemoração, não navegação).

export const EMOJI_ICONS = {
  '🏠': 'home', '📚': 'books', '🕸️': 'affiliate', '🧠': 'cards', '📊': 'chart-bar', '🏆': 'trophy', '⚙️': 'settings', '👤': 'user',
  '🌓': 'sun-moon', '☀️': 'sun', '🌙': 'moon', '✨': 'sparkles', '📸': 'photo', '✍️': 'pencil', '📷': 'camera', '🔗': 'link',
  '➕': 'plus', '👥': 'users', '⬆️': 'upload', '⬇️': 'download', '✏️': 'edit', '📖': 'book-2', '🔤': 'abc', '☁️': 'cloud', '📱': 'device-mobile',
  '⭐': 'star', '🖍️': 'highlight', '✕': 'x', '✉️': 'mail', '🏷️': 'tag', '🎯': 'target-arrow', '⏱️': 'stopwatch', '💜': 'heart',
  '🤍': 'heart', '▥': 'barcode', '✅': 'circle-check', '🗑️': 'trash', '💡': 'bulb', '🔒': 'lock', '📘': 'file-spreadsheet',
  '📗': 'file-spreadsheet', '🔎': 'search', '🏁': 'flag', '📄': 'file-text', '🌐': 'world', '⏰': 'alarm', '📅': 'calendar-plus',
  '📥': 'download', '📤': 'share', '🖼️': 'photo', '▭': 'forms', '🎈': 'balloon', '💼': 'briefcase', '🎓': 'school', '↻': 'refresh',
  '↗': 'share', '🏃': 'run', '🧱': 'stack-2', '⚡': 'bolt', '🔔': 'bell', '💬': 'message-circle', '🔄': 'refresh', '🔑': 'key',
  '🎨': 'palette', '✓': 'check', '🐞': 'bug', '⚠️': 'alert-triangle', '❓': 'help-circle', '⏸': 'player-pause', '▶': 'player-play',
  '■': 'player-stop', '📰': 'news', '📝': 'notes', '✔': 'check', '🌸': 'flower', '📜': 'file-text', '🧩': 'layout-grid', '👋': 'confetti', '📋': 'clipboard',
};

const SPRITE = 'icons/ui.svg';
export const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="${SPRITE}#${name}"></use></svg>`;

// Onde o emoji vira ícone: controles, rótulos e títulos. Fora disso (avisos, medalhas…) fica o emoji.
const WHERE = 'button, .btn, .icon-btn, .tab, .tabbar a, .seg a, label, h1, h2, h3, .chip, .avatar.ph, .imp-opt b, .big-emoji, .onb-emoji, .login-points li, .lookup-item, a.wl, .legend-row span';
// Nas dicas, o emoji pode estar no meio da frase ("no botão 🧠 de uma nota")
const INLINE = '.hint, .nudge, .card ul.small li';
const SKIP = '.toast, .badge, .streak, [data-no-tr], .club-post-text, .note-text, .daily-text, .review-card';
const ALT = Object.keys(EMOJI_ICONS).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');
const LEAD = new RegExp(`^\\s*(${ALT})\\uFE0F?\\s?`, 'u');
const ANY = new RegExp(`(${ALT})\\uFE0F?`, 'u');

function svgFor(emoji, big) {
  const tpl = document.createElement('template');
  tpl.innerHTML = ic(EMOJI_ICONS[emoji], big ? 'ic-lg' : '');
  const svg = tpl.content.firstChild;
  if (emoji === '💜') svg.classList.add('ic-fill');
  return svg;
}

// Troca o emoji de um nó de texto por <svg>: o do começo em controles e títulos, qualquer um nas dicas
export function iconize(node) {
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  if (p.closest(WHERE)) {
    const m = node.nodeValue.match(LEAD);
    if (!m) return;
    p.insertBefore(svgFor(m[1], p.closest('.big-emoji, .onb-emoji')), node);
    const rest = node.nodeValue.slice(m[0].length);
    if (!rest.trim()) node.remove();
    else node.nodeValue = ` ${rest}`;
  } else if (p.closest(INLINE)) {
    const parts = [node];
    let m;
    while ((m = node.nodeValue.match(ANY))) {
      const after = node.splitText(m.index);
      after.nodeValue = after.nodeValue.slice(m[0].length);
      p.insertBefore(svgFor(m[1]), after);
      node = after;
      parts.push(after);
    }
    // pedaços de uma frase já traduzida (quem chama marca para não traduzir de novo)
    if (parts.length > 1) return parts.map((t) => t.nodeValue.trim()).filter(Boolean);
  }
}
