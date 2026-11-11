// Aplica o tema escolhido antes de pintar a tela (evita piscar). Fica num arquivo próprio, e não
// dentro do index.html, para a política de segurança (CSP) poder proibir scripts embutidos na página.
try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* sem armazenamento */ }
