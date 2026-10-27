// Ajudantes dos testes de tela: modo pessoal (sem servidor), dados de exemplo e um PDF de teste.

// Modo pessoal: o app funciona só no aparelho (sem login), como no uso sem conta
export async function modoPessoal(page) {
  await page.route('**/config.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''");
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/javascript' } });
  });
}

const HOJE = () => new Date().toISOString().slice(0, 10);

// Grava dados de exemplo direto no banco do navegador antes de abrir o app
export async function semear(page, { books = [], notes = [], cards = [], settings = {} } = {}) {
  await page.goto('/icons/ui.svg');
  await page.evaluate(async ({ books, notes, cards, settings }) => {
    const { db } = await import('/js/db.js');
    if (books.length) await db.bulkPut('books', books);
    if (notes.length) await db.bulkPut('notes', notes);
    if (cards.length) await db.bulkPut('cards', cards);
    await db.setKV('settings', { onboarded: true, firstStepsHidden: true, dailyGoal: 20, dailyCards: 20, ...settings });
  }, { books, notes, cards, settings });
}

export const livro = (id, extra = {}) => ({ id, title: 'Rápido e Devagar', author: 'Daniel Kahneman', genre: 'Psicologia', subtheme: 'Vieses', purpose: 'hobby', status: 'reading', pages: 600, currentPage: 10, createdAt: Date.now(), ...extra });
export const artigo = (id, extra = {}) => ({
  id, kind: 'article', title: 'Por que ler devagar ajuda a lembrar', site: 'Revista', url: 'https://exemplo.com/a', status: 'want', createdAt: Date.now(),
  blocks: [{ t: 'p', x: 'Ler devagar dá tempo para cada ideia se ligar ao que você já sabe, e isso muda tudo na memória.' }, { t: 'p', x: 'Revisar em intervalos crescentes faz a memória durar muito mais do que reler tudo de uma vez.' }],
  ...extra,
});
export const nota = (id, bookId, text, extra = {}) => ({ id, bookId, text, kind: 'quote', tags: [], createdAt: Date.now(), ...extra });
export const card = (id, bookId, noteId, extra = {}) => ({ id, bookId, noteId, type: 'qa', front: 'O que é o Sistema 1?', back: 'Rápido e intuitivo', due: HOJE(), ease: 2.5, interval: 0, reps: 0, createdAt: Date.now(), ...extra });

export const lerBanco = (page, store) => page.evaluate(async (s) => (await import('/js/db.js')).db.all(s), store);

// PDF mínimo com texto e um grifo (anotação Highlight com comentário) feito "em outro app"
export function pdfDeTeste() {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = (lines) => `BT /F1 14 Tf 72 700 Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const s1 = stream(['Ler devagar ajuda a lembrar o que importa de verdade.', 'Cada ideia precisa de tempo para se ligar a outra.']);
  const s2 = stream(['Segunda pagina: a pressa e inimiga da lembranca.']);
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>',
    `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`,
    '<< /Type /Annot /Subtype /Highlight /Rect [70 678 450 696] /QuadPoints [70 696 450 696 70 678 450 678] /C [1 1 0] /Contents (Vale para os cards) /F 4 >>',
    '<< /Title (Guia de Leitura Lenta) /Author (Ana Souza) >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
