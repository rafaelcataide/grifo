// Testes do "cérebro" do app (sem tela): rode com  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import * as S from '../js/srs.js';
import { parseKindle, booksFromCSV, parseCSV } from '../js/importers.js';
import { toIsbn } from '../js/scanner.js';
import { cleanText } from '../js/ocr.js';
import { buildParams, parseResult, TASK_NAMES } from '../supabase/functions/_shared/ai-tasks.js';

const today = G.ymd();
const baseState = (over = {}) => ({ books: [], sessions: [], notes: [], cards: [], reviews: [], challenges: [], settings: { yearGoal: 12 }, ...over });

test('níveis: limites de XP', () => {
  assert.equal(G.levelInfo(0).level, 1);
  assert.equal(G.levelInfo(199).level, 1);
  assert.equal(G.levelInfo(200).level, 2);
  assert.equal(G.levelInfo(600).level, 3);
  assert.equal(G.levelInfo(1199).level, 3);
  assert.ok(G.levelInfo(10 ** 7).title, 'nível muito alto continua com título');
});

test('datas locais: soma de dias atravessa mês e ano', () => {
  assert.equal(G.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(G.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(G.daysBetween('2026-10-01', '2026-10-24'), 23);
});

test('estatísticas: sequência conta até ontem e páginas de livros antigos entram no total', () => {
  const sessions = [0, 1, 2].map((d) => ({ id: `s${d}`, bookId: 'b1', date: G.addDays(today, -d - 1), pages: 10 }));
  const books = [
    { id: 'b1', status: 'reading', pages: 300, currentPage: 30 },
    { id: 'b2', status: 'finished', pages: 200, endDate: today, genre: 'Literatura' },
  ];
  const s = G.computeStats(baseState({ sessions, books }));
  assert.equal(s.streak, 3, 'leu nos 3 dias anteriores: sequência vale até a pessoa ler hoje');
  assert.equal(s.totalPages, 30 + 200);
  assert.equal(s.finished, 1);
  assert.equal(s.pagesToday, 0);
});

test('estatísticas: XP soma páginas, livros, notas, OCR e conexões', () => {
  const s = G.computeStats(baseState({
    books: [{ id: 'b', status: 'finished', pages: 100, endDate: today }],
    notes: [{ id: 'n1', text: 'liga [[Hábitos]]', source: 'ocr', createdAt: Date.now() }],
  }));
  assert.equal(s.xp, 100 * G.XP.page + G.XP.book + G.XP.note + G.XP.ocr + G.XP.link);
});

test('medalhas: primeiro livro e maratona', () => {
  const s = G.computeStats(baseState({
    books: [{ id: 'b', status: 'finished', pages: 520, endDate: today }],
    sessions: [{ id: 's', bookId: 'b', date: today, pages: 120 }],
  }));
  const got = new Set(G.BADGES.filter((b) => b.test(s)).map((b) => b.id));
  for (const id of ['book-1', 'marathon', 'brick']) assert.ok(got.has(id), `deveria ganhar ${id}`);
  assert.ok(!got.has('book-5'));
});

test('desafio da semana é o mesmo durante a semana toda', () => {
  const s = G.computeStats(baseState());
  const a = G.weeklyChallenge(s), b = G.weeklyChallenge(G.computeStats(baseState()));
  assert.equal(a.id, b.id);
  assert.ok(a.target > 0);
});

test('repetição espaçada: acertos aumentam o intervalo, erro volta para hoje', () => {
  let c = S.newCard({ id: 'c' }, today);
  c = S.schedule(c, 2, today);
  assert.equal(c.interval, 1);
  c = S.schedule(c, 2, today);
  assert.equal(c.interval, 6);
  c = S.schedule(c, 2, today);
  assert.ok(c.interval > 6);
  const wrong = S.schedule(c, 0, today);
  assert.equal(wrong.interval, 0);
  assert.equal(wrong.due, today);
  assert.ok(wrong.ease < c.ease);
});

test('lacunas: pergunta esconde e resposta destaca', () => {
  assert.equal(S.clozeQuestion('A {{normalização}} evita {{anomalias}}'), 'A <span class="cloze">[ … ]</span> evita <span class="cloze">[ … ]</span>');
  assert.match(S.clozeAnswer('A {{normalização}}'), /<mark>normalização<\/mark>/);
});

test('Kindle: português e inglês, junta destaque estendido e ignora marcadores', () => {
  const txt = [
    'Hábitos Atômicos (Clear, James)', '- Seu destaque na página 23 | posição 300-302', '', 'Você cai ao nível de seus sistemas.', '==========',
    'Hábitos Atômicos (Clear, James)', '- Seu destaque na página 23 | posição 300-303', '', 'Você cai ao nível de seus sistemas. Mude-os.', '==========',
    'Hábitos Atômicos (Clear, James)', '- Seu marcador na página 30 | posição 410', '', '', '==========',
    'Dune (Frank Herbert)', '- Your Note on page 12 | Location 182', '', 'Usar na palestra', '==========',
  ].join('\r\n');
  const books = parseKindle(`﻿${txt}`);
  assert.equal(books.length, 2);
  const h = books.find((b) => b.title === 'Hábitos Atômicos');
  assert.equal(h.author, 'James Clear');
  assert.deepEqual(h.items.map((i) => i.text), ['Você cai ao nível de seus sistemas. Mude-os.']);
  assert.equal(h.items[0].page, 23);
  assert.equal(books.find((b) => b.title === 'Dune').items[0].kind, 'thought');
});

test('CSV: aspas, vírgulas dentro de campos e ponto e vírgula', () => {
  assert.deepEqual(parseCSV('a,"b, c","d ""e"""\n1,2,3'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(parseCSV('x;y\n1;2'), [['x', 'y'], ['1', '2']]);
});

test('Goodreads: status, nota, ISBN-13, data e série no título', () => {
  const csv = 'Book Id,Title,Author,ISBN,ISBN13,My Rating,Number of Pages,Date Read,Exclusive Shelf\n'
    + '1,"Dune (Dune, #1)",Frank Herbert,"=""0441013597""","=""9780441013593""",5,688,2024/03/15,read\n'
    + '2,Sapiens,Yuval Noah Harari,"","",0,443,,to-read';
  const { books, source } = booksFromCSV(csv);
  assert.equal(source, 'goodreads');
  assert.deepEqual(books[0], { ...books[0], title: 'Dune', isbn: '9780441013593', rating: 5, pages: 688, status: 'finished', endDate: '2024-03-15' });
  assert.equal(books[1].status, 'want');
});

test('Skoob/planilha em português: colunas e data brasileira', () => {
  const { books } = booksFromCSV('Título;Autor;Páginas;Nota;Status;Data de leitura\nDom Casmurro;Machado de Assis;256;5;Lido;12/08/2023');
  assert.equal(books[0].title, 'Dom Casmurro');
  assert.equal(books[0].status, 'finished');
  assert.equal(books[0].endDate, '2023-08-12');
});

test('ISBN: aceita com hífens, recusa dígito verificador errado', () => {
  assert.equal(toIsbn('978-85-250-6441-7'), '9788525064417');
  assert.equal(toIsbn('9788525064418'), null);
  assert.equal(toIsbn('1234567890123'), null);
});

test('OCR: limpa sobras de borda e junta linhas hifenizadas', () => {
  const t = cleanText('| no nível inter-\nnacional, não\nq Portanto, destinados\n. a corridas', false);
  assert.equal(t, 'no nível internacional, não Portanto, destinados a corridas');
});

test('IA: formato do pedido (modelo, saída estruturada, fallback) e recusa', () => {
  for (const task of TASK_NAMES) {
    const input = { notes: [], note: { text: 'x' }, candidates: [], question: 'q', text: 't', read: [], highlights: [], owned: [], title: 'T', site: 'S' };
    const p = buildParams(task, input);
    assert.ok(['claude-haiku-5-5', 'claude-sonnet-5-5'].includes(p.model));
    assert.equal(p.output_config.format.type, 'json_schema');
    // fallback no servidor só existe no Sonnet; no Haiku o parâmetro é recusado
    if (p.model === 'claude-sonnet-5-5') assert.equal(p.fallbacks, 'default');
    else assert.equal(p.fallbacks, undefined);
    assert.ok(p.output_config.effort);
    assert.equal(typeof p.messages[0].content, ['readphoto', 'bookphoto'].includes(task) ? 'object' : 'string'); // as tarefas com foto mandam imagem + texto
  }
  assert.deepEqual(parseResult({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":1}' }] }), { ok: 1 });
  assert.throws(() => parseResult({ stop_reason: 'refusal', content: [] }), /não pôde/);
});

test('IA: leitura de grifo pela foto leva a imagem e confere a entrada antes de gastar cota', async () => {
  const { validateInput, IMAGE_MAX, taskKind } = await import('../supabase/functions/_shared/ai-tasks.js');
  const image = 'A'.repeat(400);
  const p = buildParams('readphoto', { image, mode: 'highlight' });
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(taskKind('readphoto'), 'light');
  assert.deepEqual(p.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
  assert.match(p.messages[0].content[1].text, /grifos/);
  assert.match(buildParams('readphoto', { image, mode: 'page' }).messages[0].content[1].text, /página/);
  assert.equal(validateInput('readphoto', { image }), null);
  assert.equal(validateInput('readphoto', {}), 'foto ausente');
  assert.equal(validateInput('readphoto', { image: 'A'.repeat(IMAGE_MAX + 1) }), 'foto grande demais');
  assert.equal(validateInput('readphoto', { image: `${'A'.repeat(200)}<script>` }), 'foto inválida');
  assert.equal(validateInput('cards', { notes: [] }), null);
});

// página de mentira: papel de uma cor, linhas de "texto" escuras inclinadas e, se pedido, uma faixa de grifo
function paginaFalsa({ w = 600, h = 400, paper = [200, 200, 190], deg = 0, hl = null }) {
  const data = new Uint8ClampedArray(w * h * 4);
  const t = Math.tan((deg * Math.PI) / 180);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yy = y - (x - w / 2) * t; // posição ao longo da linha inclinada
      let c = paper;
      if (hl && yy > hl.y0 && yy < hl.y1 && x > 60 && x < w - 60) c = hl.color;
      // linhas a cada 24 px, 8 px de altura, com "letras" (colunas alternadas) entre as margens
      if (x > 50 && x < w - 50 && ((yy % 24) + 24) % 24 < 8 && Math.floor(x / 4) % 2 === 0 && yy > 30 && yy < h - 30) c = [40, 40, 40];
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

test('OCR: mede a inclinação das linhas da página (e não inventa ângulo onde não há texto)', async () => {
  const { estimateSkew } = await import('../js/ocr.js');
  assert.equal(estimateSkew(paginaFalsa({ deg: 0 })), 0);
  for (const deg of [-12, -5, 4, 10, 18]) {
    const got = estimateSkew(paginaFalsa({ deg }));
    assert.ok(Math.abs(got - deg) <= 1, `inclinação de ${deg}° lida como ${got}°`);
  }
  // foto lisa, sem texto: nada a endireitar
  const lisa = paginaFalsa({});
  for (let i = 0; i < lisa.data.length; i += 4) lisa.data[i] = lisa.data[i + 1] = lisa.data[i + 2] = 180;
  assert.equal(estimateSkew(lisa), 0);
});

test('OCR: acha grifo claro pela diferença para a cor do papel (creme ou azulado), sem marcar papel liso', async () => {
  const { __test, paperColor } = await import('../js/ocr.js');
  const B = 6;
  const blocos = (img) => {
    const gw = Math.ceil(img.width / B), gh = Math.ceil(img.height / B);
    const mask = __test.colorMask(img, B, gw, gh);
    return { mask, gw, total: mask.reduce((a, b) => a + b, 0) };
  };
  // rosa claro em papel creme e verde claro em papel azulado: cores tiradas de fotos reais
  for (const [paper, color] of [[[195, 195, 183], [204, 165, 166]], [[185, 200, 220], [150, 190, 178]], [[228, 216, 218], [232, 188, 225]]]) {
    const img = paginaFalsa({ paper, hl: { y0: 150, y1: 230, color } });
    const p = paperColor(img);
    const s = paper[0] + paper[1] + paper[2];
    assert.ok(Math.abs(p.cr - paper[0] / s) < 0.01 && Math.abs(p.cg - paper[1] / s) < 0.01, 'cor do papel');
    const { mask, gw, total } = blocos(img);
    assert.ok(total > 300, `grifo ${color} em papel ${paper}: ${total} blocos`);
    assert.equal(mask[Math.floor(60 / B) * gw + 20], 0, 'fora do grifo fica de fora');
    assert.equal(blocos(paginaFalsa({ paper })).total, 0, 'página sem grifo');
  }
});

test('IA: ficha do livro pela foto e resumo do artigo (formato, modelo rápido e entrada conferida)', async () => {
  const { validateInput, taskKind, SUMMARY_MIN } = await import('../supabase/functions/_shared/ai-tasks.js');
  const image = 'A'.repeat(400);
  const ficha = buildParams('bookphoto', { image });
  assert.equal(ficha.model, 'claude-haiku-5-5');
  assert.equal(taskKind('bookphoto'), 'light');
  assert.equal(ficha.messages[0].content[0].source.data, image);
  assert.deepEqual(ficha.output_config.format.schema.required, ['found', 'title', 'subtitle', 'author', 'publisher', 'city', 'year', 'edition', 'isbn', 'pages']);
  assert.match(ficha.system, /não complete com o que você sabe/); // copia o que está na foto, não o que "lembra" do livro
  assert.equal(validateInput('bookphoto', { image }), null);
  assert.equal(validateInput('bookphoto', {}), 'foto ausente');

  const texto = 'Ler devagar ajuda a lembrar. '.repeat(40);
  const resumo = buildParams('artsummary', { title: 'Por que ler "devagar"', site: 'Revista', text: texto });
  assert.equal(taskKind('artsummary'), 'light');
  assert.match(resumo.messages[0].content, /^<artigo titulo="Por que ler "devagar"" site="Revista">\nLer devagar/);
  assert.deepEqual(resumo.output_config.format.schema.required, ['gist', 'points', 'audience']);
  // artigo enorme: o texto enviado é cortado (o custo por resumo tem teto)
  assert.ok(buildParams('artsummary', { title: 't', site: 's', text: 'a'.repeat(200000) }).messages[0].content.length < 61000);
  assert.equal(validateInput('artsummary', { text: texto }), null);
  assert.equal(validateInput('artsummary', { text: 'curto' }), 'texto curto demais para resumir');
  assert.equal(validateInput('artsummary', {}), 'texto curto demais para resumir');
  assert.ok(SUMMARY_MIN >= 200);
});

test('segurança: leitor de artigos recusa endereços de rede interna (IPv4 e IPv6)', async () => {
  const { isPrivateIp } = await import('../supabase/functions/_shared/net.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:10.0.0.1', '999.1.1.1', 'abc']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '200.160.2.3', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('segurança: links externos só abrem http(s)', async () => {
  const { safeHref } = await import('../js/util.js');
  assert.equal(safeHref('https://exemplo.com/a?b=1'), 'https://exemplo.com/a?b=1');
  assert.equal(safeHref(' http://exemplo.com '), 'http://exemplo.com/');
  for (const ruim of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'exemplo.com', '', null, undefined]) {
    assert.equal(safeHref(ruim), '#', String(ruim));
  }
});

test('segurança: a política de conteúdo (CSP) cobre os serviços que o código chama e proíbe scripts embutidos', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';
  const dir = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.ok(!dir['script-src'].includes("'unsafe-inline'") && !dir['script-src'].includes("'unsafe-eval'"), 'script-src sem unsafe-inline/eval');
  assert.deepEqual(dir['object-src'], ["'none'"]);
  assert.deepEqual(dir['base-uri'], ["'self'"]);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'index.html sem script embutido');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'fontes servidas pelo app');
  // todo endereço https usado para buscar dados ou carregar código precisa estar liberado
  const allowed = [...dir['connect-src'], ...dir['script-src']];
  const ok = (origin) => allowed.includes(origin) || allowed.some((a) => a.includes('*') && new RegExp(`^${a.replace(/[.]/g, '\\.').replace('*', '[a-z0-9-]+')}$`).test(origin));
  const onlyLinks = ['https://www.dicio.com.br', 'https://dicionario-aberto.net', 'https://rafaelcataide.github.io']; // aparecem só como link ou endereço do app
  const used = new Set();
  for (const f of ['js', 'js/telas']) {
    for (const name of fs.readdirSync(new URL(`../${f}/`, import.meta.url))) {
      if (!name.endsWith('.js') || name.startsWith('i18n')) continue;
      const src = fs.readFileSync(new URL(`../${f}/${name}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/https:\/\/[a-zA-Z0-9.-]+/g)) used.add(m[0]);
    }
  }
  // folhas de estilo carregadas pelo código (o leitor de PDF usa a dele, do jsDelivr): precisam estar em style-src
  const pdfSrc = fs.readFileSync(new URL('../js/pdf.js', import.meta.url), 'utf8');
  if (/rel = 'stylesheet'/.test(pdfSrc)) assert.ok(dir['style-src'].includes('https://cdn.jsdelivr.net'), 'style-src libera a folha de estilo do leitor de PDF');
  const faltando = [...used].filter((o) => !ok(o) && !onlyLinks.includes(o));
  assert.deepEqual(faltando, [], 'endereços usados no código e ausentes da CSP');
});

test('busca de livros: junta as bases, completa campos e põe primeiro as edições em português', async () => {
  const B = await import('../js/livros-busca.js');
  assert.equal(B.isbn13('85-390-0383-0'), '9788539003839'); // ISBN-10 vira 13
  assert.equal(B.isbn13('978-85-390-0383-9'), '9788539003839');
  assert.equal(B.isbn13('0-306-40615-2'), '9780306406157'); // par conhecido de ISBN-10 e ISBN-13
  assert.equal(B.isbn13('abc'), '');

  const google = B.fromGoogle({ items: [
    { volumeInfo: { title: 'Thinking, Fast and Slow', authors: ['Daniel Kahneman'], pageCount: 499, language: 'en', publishedDate: '2011-10-25', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780374275631' }], imageLinks: { thumbnail: 'http://books.google.com/en.jpg' } } },
    { volumeInfo: { title: 'Rápido e devagar', subtitle: 'Duas formas de pensar', authors: ['Daniel Kahneman'], language: 'pt-BR', publishedDate: '2012', industryIdentifiers: [{ type: 'ISBN_10', identifier: '8539003830' }], imageLinks: { thumbnail: 'http://books.google.com/pt.jpg' } } },
    { volumeInfo: {} }, // sem título: fora
  ] });
  assert.equal(google.length, 2);
  assert.deepEqual([google[1].title, google[1].lang, google[1].isbn, google[1].cover], ['Rápido e devagar: Duas formas de pensar', 'pt', '9788539003839', 'https://books.google.com/pt.jpg']);

  const openLib = B.fromOpenLibrary({ docs: [
    { title: 'Rápido e Devagar', author_name: ['Daniel Kahneman'], number_of_pages_median: 608, isbn: ['8539003830', '9788539003839'], publisher: ['Objetiva'], first_publish_year: 2011, language: ['por'] },
    { title: 'Noise', author_name: ['Daniel Kahneman', 'Olivier Sibony'], language: ['eng', 'por'], cover_i: 7 },
  ] });
  assert.deepEqual([openLib[0].isbn, openLib[0].lang, openLib[1].lang, openLib[1].cover], ['9788539003839', 'pt', '', 'https://covers.openlibrary.org/b/id/7-M.jpg']);

  // mesmo ISBN nas duas bases = um resultado só, com capa do Google e páginas e editora da Open Library
  const juntos = B.mergeBooks([google, openLib]);
  assert.equal(juntos.length, 3);
  const pt = juntos.find((x) => x.isbn === '9788539003839');
  assert.deepEqual([pt.title, pt.cover, pt.pages, pt.publisher, pt.srcs], ['Rápido e devagar: Duas formas de pensar', 'https://books.google.com/pt.jpg', 608, 'Objetiva', ['google', 'openlibrary']]);
  // sem ISBN de um lado, vale título principal + sobrenome do autor
  assert.equal(B.mergeBooks([[{ title: 'O Hobbit: ou lá e de volta outra vez', author: 'J. R. R. Tolkien', isbn: '', src: 'google' }], [{ title: 'O hobbit', author: 'J.R.R. Tolkien', isbn: '9788595084742', pages: 336, src: 'openlibrary' }]]).length, 1);
  // edições com ISBN diferente continuam separadas
  assert.equal(B.mergeBooks([[{ title: 'O Hobbit', author: 'Tolkien', isbn: '9788595084742', src: 'google' }], [{ title: 'O Hobbit', author: 'Tolkien', isbn: '9788578277109', src: 'openlibrary' }]]).length, 2);

  // em português primeiro; em inglês por último; o app em inglês inverte
  assert.deepEqual(B.rankBooks(juntos, { lang: 'pt' }).map((x) => x.title), ['Rápido e devagar: Duas formas de pensar', 'Thinking, Fast and Slow', 'Noise']);
  // o que bate com o que foi digitado vem antes de registros mais completos que só têm uma palavra em comum
  const lista = [
    { title: 'Amor de Capitu', author: 'Fernando Sabino', lang: 'pt', cover: 'c', pages: 292, isbn: '1', publisher: 'Ática' },
    { title: 'Enquanto isso em Dom Casmurro', author: 'José Martins', lang: 'pt', cover: 'c', pages: 124, isbn: '2', publisher: 'Edifurb' },
    { title: 'Dom Casmurro', author: 'Machado de Assis', lang: '', pages: 269 },
    { title: 'Dom Casmurro', author: '', lang: '', publisher: 'Paulus' },
    { title: 'Dom Casmurro: a Novel', author: 'Machado de Assis', lang: 'en' },
  ];
  assert.deepEqual(B.rankBooks(lista, { lang: 'pt', query: 'dom casmurro' }).map((x) => `${x.title} / ${x.author}`), [
    'Dom Casmurro / Machado de Assis', 'Dom Casmurro / ', 'Dom Casmurro: a Novel / Machado de Assis', 'Enquanto isso em Dom Casmurro / José Martins',
  ]); // "Amor de Capitu" não tem as palavras digitadas: sai
  assert.equal(B.rankBooks(lista, { query: 'machado assis' })[0].author, 'Machado de Assis'); // busca pelo autor
  assert.equal(B.rankBooks(lista, { query: 'zzz qqq' }).length, 5); // nada bate: mostra o que veio
  assert.equal(B.rankBooks(juntos, { lang: 'en' })[0].title, 'Thinking, Fast and Slow');
  assert.equal(B.rankBooks(juntos, { lang: 'pt', limit: 2 }).length, 2);

  // busca por ISBN: tudo é o mesmo livro; a BrasilAPI manda, as outras completam
  const br = B.fromBrasilApi({ title: 'Rápido e devagar', authors: ['Daniel Kahneman'], publisher: 'Objetiva', location: 'Rio de Janeiro', year: 2012, isbn: '9788539003839' });
  const um = B.mergeBooks([br, google.slice(1), openLib.slice(0, 1)], { sameBook: true });
  assert.equal(um.length, 1);
  assert.deepEqual([um[0].title, um[0].city, um[0].year, um[0].cover, um[0].pages], ['Rápido e devagar', 'Rio de Janeiro', '2012', 'https://books.google.com/pt.jpg', 608]);
  assert.deepEqual(B.fromBrasilApi(null), []);
});

test('texto: ligações [[ ]] e escape de HTML', async () => {
  const U = await import('../js/util.js');
  assert.deepEqual(U.linksOf('ver [[Hábitos]] e [[Normalização|normalizar]]'), ['Hábitos', 'Normalização']);
  assert.equal(U.plainText('ver [[Hábitos]] e [[Normalização|normalizar]]'), 'ver Hábitos e normalizar');
  assert.equal(U.esc('<b>"a" & \'b\'</b>'), '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
});

test('plano de prova: meta do dia, atrasados e revisão na véspera', async () => {
  const S = await import('../js/srs.js');
  const card = (id, due, reps = 1) => ({ id, due, reps, createdAt: 0 });
  const cards = [card('a', '2026-11-01'), card('b', '2026-11-02'), card('c', '2026-11-05'), card('d', '2026-11-08'), card('e', '2026-12-30'), card('f', '2026-11-03', 0)];
  const p = S.examPlan(cards, '2026-11-10', '2026-11-02');
  assert.equal(p.daysLeft, 8);
  assert.equal(p.total, 6);
  assert.equal(p.learned, 5);
  // 5 cards voltam antes da prova; atrasados (a, b) entram todos; meta = máx(2, ceil(5/8)) = 2
  assert.deepEqual(p.queue, ['a', 'b']);
  // revisado hoje e marcado para amanhã: não é puxado de volta para hoje
  assert.equal(S.examPlan([{ id: 'x', due: '2026-11-03', reps: 1, lastReview: '2026-11-02' }], '2026-11-10', '2026-11-02').goal, 0);
  // prova já passou: nada a revisar pelo plano
  assert.equal(S.examPlan(cards, '2026-11-01', '2026-11-02').goal, 0);
  // card que voltaria depois da prova vai para a véspera; na véspera não muda
  assert.equal(S.capForExam({ due: '2026-12-01' }, '2026-11-10', '2026-11-02').due, '2026-11-09');
  assert.equal(S.capForExam({ due: '2026-12-01' }, '2026-11-10', '2026-11-09').due, '2026-12-01');
  assert.equal(S.capForExam({ due: '2026-11-05' }, '2026-11-10', '2026-11-02').due, '2026-11-05');
});

test('exportar: Markdown (Obsidian/Notion), CSV e texto do Anki', async () => {
  const E = await import('../js/export.js');
  const books = [{ id: 'b1', title: 'Rápido e Devagar', author: 'Daniel Kahneman', genre: 'Psicologia', subtheme: 'Vieses', purpose: 'academic', status: 'finished', pages: 600, rating: 5 }];
  const articles = [{ id: 'a1', kind: 'article', title: 'Ler: devagar?', url: 'https://ex.com/a', site: 'Ex', genre: 'Psicologia', status: 'want' }];
  const notes = [
    { id: 'n1', bookId: 'b1', kind: 'quote', text: 'O [[Sistema 1]] é rápido.', page: 20, createdAt: 1, tags: ['mente'] },
    { id: 'n2', bookId: 'a1', kind: 'thought', title: 'Ancoragem', text: 'Primeiro número pesa.', createdAt: 2 },
  ];
  const files = E.markdownFiles({ books, articles, notes });
  const paths = files.map((f) => f.path).sort();
  // ':' e '?' não podem estar em nome de arquivo
  assert.deepEqual(paths, ['Artigos/Ler devagar.md', 'Livros/Rápido e Devagar.md', 'Notas/Ancoragem.md', 'Temas/Psicologia.md']);
  const book = files.find((f) => f.path === 'Livros/Rápido e Devagar.md').content;
  assert.match(book, /^---\ntipo: livro\nautor: "Daniel Kahneman"/);
  assert.match(book, /> O \[\[Sistema 1\]\] é rápido\./); // ligações mantidas para o Obsidian
  assert.match(book, /p\. 20 · #mente/);
  assert.match(files.find((f) => f.path === 'Temas/Psicologia.md').content, /- \[\[Rápido e Devagar\]\] · Vieses/);
  assert.match(E.booksCsv({ books, articles }), /"Rápido e Devagar","Livro","Daniel Kahneman"/);
  const anki = E.ankiText({ books, articles, cards: [
    { bookId: 'b1', type: 'cloze', front: 'O {{Sistema 1}} é {{rápido}}.' },
    { bookId: 'b1', type: 'qa', front: 'O que é [[ancoragem]]?', back: 'Peso do\nprimeiro número' },
  ] });
  assert.match(anki, /^#separator:tab\n#html:true/);
  assert.match(anki, /Cloze\tGrifo::Rápido e Devagar\tO \{\{c1::Sistema 1\}\} é \{\{c2::rápido\}\}\.\t\tgrifo Psicologia/);
  assert.match(anki, /Basic\tGrifo::Rápido e Devagar\tO que é ancoragem\?\tPeso do<br>primeiro número/);
});

test('PDF: texto embaixo de um grifo feito em outro app', async () => {
  const { textUnder } = await import('../js/pdf.js');
  // duas linhas de texto (pdf.js: transform[4]=x, transform[5]=y da base da linha)
  const items = [
    { str: 'Ler devagar ajuda a lembrar', transform: [1, 0, 0, 12, 72, 700], width: 160, height: 12 },
    { str: 'o que importa de verdade.', transform: [1, 0, 0, 12, 72, 684], width: 150, height: 12 },
  ];
  // grifo pegando a segunda metade da 1ª linha e a 2ª linha inteira
  assert.equal(textUnder(items, [[152, 699, 232, 712], [72, 683, 222, 696]]), 'ajuda a lembrar o que importa de verdade.');
  assert.equal(textUnder(items, [[300, 600, 400, 610]]), '');
});

test('mapa: esconder tipos de ponto sem desfazer as ligações', async () => {
  const { applyShow } = await import('../js/graph.js');
  const d = {
    groups: [{ key: 'psi', label: 'Psicologia' }],
    nodes: [
      { id: 'b:1', type: 'book', group: 'psi' }, { id: 'b:2', type: 'book', group: 'psi' },
      { id: 'c:sis', type: 'concept' }, { id: 'c:mente', type: 'tag' }, { id: 'c:vieses', type: 'subtheme', group: 'psi' },
      { id: 'n:1', type: 'note', parent: 'b:1' },
    ],
    links: [{ source: 'b:1', target: 'c:sis' }, { source: 'b:2', target: 'c:sis' }, { source: 'b:1', target: 'c:mente' }, { source: 'b:1', target: 'c:vieses' }],
  };
  const all = { books: true, areas: true, subthemes: true, ideas: true, tags: true };
  assert.equal(applyShow(d, all).nodes.length, 6);
  // sem ideias: os dois livros que citavam a mesma ideia passam a se ligar direto
  const noIdeas = applyShow(d, { ...all, ideas: false });
  assert.ok(!noIdeas.nodes.some((n) => n.id === 'c:sis'));
  assert.ok(noIdeas.links.some((l) => [l.source, l.target].sort().join() === 'b:1,b:2'));
  // sem tags e sem subtemas
  const clean = applyShow(d, { ...all, tags: false, subthemes: false });
  assert.deepEqual(clean.nodes.map((n) => n.id).sort(), ['b:1', 'b:2', 'c:sis', 'n:1']);
  // sem livros: somem também as notas (que aparecem em volta do livro); a ideia fica
  const noBooks = applyShow(d, { ...all, books: false });
  assert.ok(!noBooks.nodes.some((n) => n.type === 'book' || n.type === 'note'));
  assert.ok(noBooks.links.some((l) => [l.source, l.target].includes('c:sis') && [l.source, l.target].includes('c:mente')));
  // sem áreas: nenhuma ilha
  const noAreas = applyShow(d, { ...all, areas: false });
  assert.equal(noAreas.groups.length, 0);
  assert.ok(noAreas.nodes.every((n) => !n.group));
});

test('tags: separa por ; e vírgula, tira # e repetidas', async () => {
  const { splitTags } = await import('../js/util.js');
  assert.deepEqual(splitTags('religião;umbanda'), ['religião', 'umbanda']);
  assert.deepEqual(splitTags(['religião;espiritismo', '#Religião', 'umbanda, #fé ;']), ['religião', 'espiritismo', 'umbanda', 'fé']);
  assert.deepEqual(splitTags(''), []);
});

test('planos: fichamento de livro inteiro no Pro conta 2 usos', async () => {
  const { pesoDe } = await import('../supabase/functions/_shared/planos.js');
  const notas = (n) => ({ notes: Array.from({ length: n }, (_, i) => ({ id: i })) });
  assert.equal(pesoDe('pro', 'summary', notas(121)), 2);
  assert.equal(pesoDe('pro', 'summary', notas(120)), 1);
  assert.equal(pesoDe('plus', 'summary', notas(300)), 1);
  assert.equal(pesoDe('pro', 'ask', notas(300)), 1);
  assert.equal(pesoDe('pro', 'summary', undefined), 1);
});

test('planos: cotas por plano e período (mês ou o total do teste grátis)', async () => {
  const { PLANOS, planoDe, periodoDe } = await import('../supabase/functions/_shared/planos.js');
  assert.equal(planoDe('nada'), PLANOS.free);
  assert.ok(PLANOS.pro.heavy > PLANOS.plus.heavy && PLANOS.plus.heavy > PLANOS.free.heavy);
  const outubro = new Date('2026-10-15T12:00:00Z');
  assert.equal(periodoDe('free', 'heavy', outubro), 'total'); // grátis: 3 testes para sempre
  assert.equal(periodoDe('free', 'light', outubro), '2026-10');
  assert.equal(periodoDe('plus', 'heavy', outubro), '2026-10');
});

test('IA: tarefas leves e pesadas, e o Pro lê mais notas', async () => {
  const { taskKind, buildParams } = await import('../supabase/functions/_shared/ai-tasks.js');
  assert.equal(taskKind('ask'), 'heavy');
  assert.equal(taskKind('summary'), 'heavy');
  assert.equal(taskKind('fixocr'), 'light');
  const notes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, text: 'x', book: 'L' }));
  const contar = (p) => (p.messages[0].content.match(/<nota /g) || []).length;
  assert.equal(contar(buildParams('ask', { question: 'q', notes, depth: 'std' })), 80);
  assert.equal(contar(buildParams('ask', { question: 'q', notes, depth: 'pro' })), 160);
});

test('referências: ABNT e APA de livro, artigo e obra sem autor, e citação com página', async () => {
  const R = await import('../js/referencias.js');
  const hoje = new Date(2026, 10, 6);
  const livro = { title: 'Rápido e devagar: duas formas de pensar', author: 'Daniel Kahneman', publisher: 'Objetiva', city: 'Rio de Janeiro', year: '2012' };
  assert.equal(R.reference(livro, 'abnt').text, 'KAHNEMAN, Daniel. Rápido e devagar: duas formas de pensar. Rio de Janeiro: Objetiva, 2012.');
  assert.match(R.reference(livro, 'abnt').html, /<b>Rápido e devagar<\/b>: duas formas de pensar/);
  assert.equal(R.reference(livro, 'apa').text, 'Kahneman, D. (2012). Rápido e devagar: duas formas de pensar. Objetiva.');
  assert.equal(R.citation(livro, 21, 'abnt'), '(KAHNEMAN, 2012, p. 21)');
  assert.equal(R.citation(livro, 21, 'apa'), '(Kahneman, 2012, p. 21)');
  const dois = { title: 'Freakonomics', author: 'Steven D. Levitt, Stephen J. Dubner', publisher: 'Campus', city: 'Rio de Janeiro', year: '2005', edition: '3' };
  assert.equal(R.reference(dois, 'abnt').text, 'LEVITT, Steven D.; DUBNER, Stephen J. Freakonomics. 3. ed. Rio de Janeiro: Campus, 2005.');
  assert.equal(R.reference(dois, 'apa').text, 'Levitt, S. D., & Dubner, S. J. (2005). Freakonomics (3ª ed.). Campus.');
  assert.equal(R.reference({ title: 'Memórias', author: 'SILVA FILHO, João', year: '1990' }, 'apa').text, 'Silva Filho, J. (1990). Memórias.');
  assert.equal(R.reference({ title: 'O livro sem autor' }, 'abnt').text, 'O LIVRO sem autor. [S. l.]: [s. n.], [s. d.].');
  const artigo = { kind: 'article', title: 'Aplicativo de apoio', author: 'Maria Souza; Ana Lima; Paulo Reis; Lia Costa', site: 'Acta Paulista de Enfermagem', url: 'https://x.org/a', published: '2024-03-15' };
  assert.equal(R.reference(artigo, 'abnt', hoje).text, 'SOUZA, Maria et al. Aplicativo de apoio. Acta Paulista de Enfermagem, 15 mar. 2024. Disponível em: https://x.org/a. Acesso em: 6 nov. 2026.');
  assert.equal(R.citation(artigo, null, 'apa'), '(Souza et al., 2024)');
  assert.deepEqual(R.missingFields({ title: 'X', author: 'A B' }), ['publisher', 'city', 'year']);
});

test('mapa em galhos: temas, subtemas, livros, ideias e posições dos dois lados', async () => {
  const A = await import('../js/arvore.js');
  const books = [
    { id: 'b1', title: 'Rápido e Devagar', genre: 'Psicologia', subtheme: 'Vieses' },
    { id: 'b2', title: 'Hábitos Atômicos', genre: 'Produtividade' },
    { id: 'b3', title: 'Pense de Novo', genre: 'Psicologia', subtheme: 'Vieses' },
  ];
  const notes = [
    { id: 'n1', bookId: 'b1', text: 'O [[Sistema 1]] e a [[Heurística]].', tags: ['mente'] },
    { id: 'n2', bookId: 'b2', text: '[[Sistema 1]] cria hábitos.' },
    { id: 'n3', bookId: null, text: 'Solta: [[Sistema 1]].' },
  ];
  const idx = A.buildIndex({ books, notes, resolve: () => ({ type: 'concept' }) });
  const kids = (n) => A.childrenOf(idx, n).map((c) => `${c.kind}:${c.label}`);
  assert.deepEqual(kids(A.nodeOf(idx, 'lib')), ['theme:Psicologia', 'theme:Produtividade', 'loose:Notas soltas']);
  assert.deepEqual(kids(A.nodeOf(idx, 'theme', 'psicologia')), ['subtheme:Vieses']);
  assert.deepEqual(kids(A.nodeOf(idx, 'book', 'b1')), ['idea:#mente', 'idea:Heurística', 'idea:Sistema 1', 'notes:1 grifo']);
  assert.deepEqual(kids(A.nodeOf(idx, 'idea', 'sistema 1')), ['ideaBook:Hábitos Atômicos', 'ideaBook:Rápido e Devagar', 'note:Solta: Sistema 1.', 'related:Ideias próximas']);
  const L = A.layoutTree(A.nodeOf(idx, 'lib'), { children: (n) => A.childrenOf(idx, n), expanded: new Set(['root/theme:psicologia']), measure: () => 100 });
  const at = Object.fromEntries(L.nodes.map((n) => [n.label, n]));
  assert.equal(at['Minha biblioteca'].x, 0);
  assert.ok(at.Psicologia.x > 0 && at.Vieses.x > at.Psicologia.x); // um galho e o filho, para a direita
  assert.ok(at['Notas soltas'].x < 0); // o outro lado
  assert.equal(L.edges.length, L.nodes.length - 1);
});
