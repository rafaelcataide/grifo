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
    const input = { notes: [], note: { text: 'x' }, candidates: [], question: 'q', text: 't', read: [], highlights: [], owned: [] };
    const p = buildParams(task, input);
    assert.ok(['claude-haiku-5-5', 'claude-sonnet-5-5'].includes(p.model));
    assert.equal(p.output_config.format.type, 'json_schema');
    // fallback no servidor só existe no Sonnet; no Haiku o parâmetro é recusado
    if (p.model === 'claude-sonnet-5-5') assert.equal(p.fallbacks, 'default');
    else assert.equal(p.fallbacks, undefined);
    assert.ok(p.output_config.effort);
    assert.equal(typeof p.messages[0].content, 'string');
  }
  assert.deepEqual(parseResult({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":1}' }] }), { ok: 1 });
  assert.throws(() => parseResult({ stop_reason: 'refusal', content: [] }), /não pôde/);
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
