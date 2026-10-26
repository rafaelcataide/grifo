// Monta dist/ só com o que o app precisa para rodar no navegador (o que vai para a hospedagem).
// Ficam de fora: testes, ferramentas, guias, o resto do código do servidor (supabase/) e arquivos locais.
// Uso: node tools/build.js   (ou npm run build)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Arquivos do app; a lista do service worker (SHELL) é a referência e é conferida nos testes
const FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'config.js',
  'supabase/functions/_shared/ai-tasks.js', // usado pelo app no modo pessoal (IA com a chave do usuário)
];
const DIRS = ['css', 'js', 'icons', '.well-known'];

// Cabeçalhos da hospedagem (Cloudflare Pages e Netlify leem o arquivo _headers)
const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

# sempre buscar a versão nova destes (o resto é atualizado pelo service worker)
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/config.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
`;

function copy(rel) {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) return 0;
  const to = path.join(dist, rel);
  if (fs.statSync(from).isDirectory()) {
    return fs.readdirSync(from).reduce((n, f) => n + copy(path.join(rel, f)), 0);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return 1;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
let n = 0;
for (const f of [...FILES, ...DIRS]) n += copy(f);
fs.writeFileSync(path.join(dist, '_headers'), HEADERS);
console.log(`dist/: ${n} arquivos + _headers`);
