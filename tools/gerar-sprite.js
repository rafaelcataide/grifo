// Monta icons/ui.svg só com os ícones que o app usa (Tabler Icons, licença MIT).
// Uso: node tools/gerar-sprite.js   (precisa de internet; rode de novo ao adicionar ícones em js/icons.js)
const fs = require('fs');
const path = require('path');

const VERSION = '3.48.0';
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'icons.js'), 'utf8');
const names = [...new Set([...src.matchAll(/'[^']+': '([a-z0-9-]+)'/g)].map((m) => m[1]))].sort();

(async () => {
  const symbols = [];
  const missing = [];
  for (const name of names) {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/@tabler/icons@${VERSION}/icons/outline/${name}.svg`);
    if (!res.ok) { missing.push(name); continue; }
    const svg = await res.text();
    const inner = svg
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, '')
      .trim();
    symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`);
  }
  if (missing.length) { console.error(`Ícones não encontrados: ${missing.join(', ')}`); process.exit(1); }
  const out = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n<!-- Tabler Icons ${VERSION} (MIT) — gerado por tools/gerar-sprite.js -->\n${symbols.join('\n')}\n</svg>\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'icons', 'ui.svg'), out);
  console.log(`icons/ui.svg: ${symbols.length} ícones, ${(out.length / 1024).toFixed(1)} KB`);
})();
