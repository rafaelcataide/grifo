// Baixa as fontes do app (Fraunces e Inter, licença OFL) para a pasta fonts/ e gera css/fonts.css.
// Assim o app não carrega nada do Google Fonts (o Google deixaria de receber o IP de quem abre o app).
// Uso: node tools/baixar-fontes.js   (precisa de internet; só é preciso rodar de novo para trocar de fonte)
const fs = require('fs');
const path = require('path');

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600;700&display=swap';
const SUBSETS = ['latin', 'latin-ext']; // português e inglês
const root = path.join(__dirname, '..');

(async () => {
  const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } })).text();
  const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[^}]+\})/g)].filter((m) => SUBSETS.includes(m[1]));
  if (!blocks.length) throw new Error('não achei as fontes na resposta do Google Fonts');
  const files = new Map();
  let out = '/* Fraunces e Inter (licença SIL OFL 1.1), servidas pelo próprio app. Gerado por tools/baixar-fontes.js */\n';
  for (const [, subset, block] of blocks) {
    const url = block.match(/url\((https:[^)]+)\)/)[1];
    const family = block.match(/font-family: '([^']+)'/)[1].toLowerCase();
    const style = block.match(/font-style: (\w+)/)[1];
    if (!files.has(url)) {
      const name = `${family}-${style}-${subset}${[...files.values()].includes(`${family}-${style}-${subset}.woff2`) ? `-${files.size}` : ''}.woff2`;
      fs.writeFileSync(path.join(root, 'fonts', name), Buffer.from(await (await fetch(url)).arrayBuffer()));
      files.set(url, name);
    }
    out += `${block.replace(/url\(https:[^)]+\)/, `url(../fonts/${files.get(url)})`)}\n`;
  }
  fs.writeFileSync(path.join(root, 'css', 'fonts.css'), out);
  console.log(`${files.size} arquivos em fonts/:`, [...files.values()].join(', '));
})().catch((e) => { console.error(e.message); process.exit(1); });
