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
