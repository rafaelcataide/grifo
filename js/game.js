// Estatísticas, XP, níveis, sequências, conquistas e desafios semanais.

export const XP = { page: 1, book: 100, note: 10, ocr: 5, link: 5, card: 5, review: 2, challenge: 50 };

export const LEVELS = [
  'Leitor Curioso', 'Aprendiz de Páginas', 'Explorador', 'Leitor Assíduo', 'Caçador de Histórias',
  'Devorador de Livros', 'Bibliófilo', 'Erudito', 'Curador de Ideias', 'Sábio',
  'Mestre das Letras', 'Guardião da Biblioteca', 'Arquivista Lendário', 'Oráculo Literário', 'Lenda Literária',
];

// Nível L começa em 100·L·(L-1) XP: 0, 200, 600, 1200, 2000… (~1 livro médio por nível no começo)
export const xpForLevel = (l) => 100 * l * (l - 1);

export function levelInfo(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, title: LEVELS[Math.min(level - 1, LEVELS.length - 1)], cur, next, progress: (xp - cur) / (next - cur) };
}

// ---------- datas (sempre no fuso local, formato AAAA-MM-DD) ----------
export const ymd = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
export const mondayOf = (s) => {
  const d = parseYmd(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};

const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);

export function computeStats(st) {
  const today = ymd();
  const year = String(new Date().getFullYear());

  // Páginas por dia vindas de sessões reais (base de sequências e mapa de calor)
  const sessDays = new Map();
  const sessByBook = new Map();
  for (const s of st.sessions) {
    const p = Number(s.pages) || 0;
    if (p <= 0) continue;
    add(sessDays, s.date, p);
    add(sessByBook, s.bookId, p);
  }

  // Todas as páginas: sessões + livros concluídos cadastrados sem sessões (leituras antigas)
  const pagesByDay = new Map(sessDays);
  const finishedBooks = st.books.filter((b) => b.status === 'finished');
  for (const b of finishedBooks) {
    const rest = (Number(b.pages) || 0) - (sessByBook.get(b.id) || 0);
    if (rest > 0) add(pagesByDay, b.endDate || ymd(b.createdAt), rest);
  }
  let totalPages = 0;
  for (const v of pagesByDay.values()) totalPages += v;

  // Sequência atual (conta se leu hoje ou ontem) e maior sequência
  let streak = 0;
  let d = sessDays.has(today) ? today : addDays(today, -1);
  while (sessDays.has(d)) { streak++; d = addDays(d, -1); }
  let longest = 0, run = 0, prev = null;
  for (const day of [...sessDays.keys()].sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }

  let maxDay = 0, maxDayDate = null;
  for (const [k, v] of sessDays) if (v > maxDay) { maxDay = v; maxDayDate = k; }

  let last30 = 0;
  for (let i = 0; i < 30; i++) last30 += sessDays.get(addDays(today, -i)) || 0;

  const genres = new Map(), authors = new Map(), purposes = new Map(), subthemes = new Map();
  for (const b of finishedBooks) {
    if (b.genre) add(genres, b.genre.trim(), 1);
    if (b.genre && b.subtheme) add(subthemes, `${b.genre.trim()} › ${b.subtheme.trim()}`, 1);
    if (b.author) add(authors, b.author.trim(), 1);
    add(purposes, b.purpose || 'hobby', 1);
  }
  const studyBooks = finishedBooks.filter((b) => b.purpose === 'professional' || b.purpose === 'academic').length;
  const rated = st.books.filter((b) => b.rating > 0);

  const ocrNotes = st.notes.filter((n) => n.source === 'ocr').length;
  const hasLink = (n) => /\[\[[^\]]+\]\]/.test(n.text || '');
  const linkedNotes = st.notes.filter(hasLink).length;
  const cards = st.cards || [], reviews = st.reviews || [];
  const dueCards = cards.filter((c) => c.due <= today).length;
  const reviewsToday = reviews.filter((r) => r.date === today).length;
  const retention = reviews.length ? reviews.filter((r) => r.grade > 0).length / reviews.length : 0;

  // Semana atual (segunda a domingo)
  const weekStart = mondayOf(today);
  const startTs = parseYmd(weekStart).getTime();
  const week = { start: weekStart, days: 0, pages: 0, maxDay: 0, notes: 0, ocr: 0, links: 0, reviews: 0 };
  for (let i = 0; i < 7; i++) {
    const v = sessDays.get(addDays(weekStart, i)) || 0;
    if (v > 0) week.days++;
    week.pages += v;
    week.maxDay = Math.max(week.maxDay, v);
  }
  for (const n of st.notes) {
    if (n.createdAt >= startTs) { week.notes++; if (n.source === 'ocr') week.ocr++; if (hasLink(n)) week.links++; }
  }
  week.reviews = reviews.filter((r) => r.date >= weekStart).length;

  const xpBreakdown = {
    pages: totalPages * XP.page,
    books: finishedBooks.length * XP.book,
    notes: st.notes.length * XP.note + ocrNotes * XP.ocr + linkedNotes * XP.link,
    memory: cards.length * XP.card + reviews.length * XP.review,
    challenges: st.challenges.length * XP.challenge,
  };
  const xp = Object.values(xpBreakdown).reduce((a, b) => a + b, 0);

  return {
    today, year, sessDays, pagesByDay, sessByBook, totalPages, streak, longest, maxDay, maxDayDate,
    pagesToday: sessDays.get(today) || 0,
    avg30: last30 / 30,
    finishedBooks,
    finished: finishedBooks.length,
    finishedThisYear: finishedBooks.filter((b) => (b.endDate || '').startsWith(year)).length,
    maxBookPages: Math.max(0, ...finishedBooks.map((b) => Number(b.pages) || 0)),
    genres, authors, rated, purposes, subthemes, studyBooks,
    notes: st.notes.length, ocrNotes, linkedNotes,
    cards: cards.length, reviews: reviews.length, dueCards, reviewsToday, retention,
    week, xp, xpBreakdown,
    yearGoal: st.settings.yearGoal,
  };
}

export const BADGES = [
  { id: 'book-1', icon: '📘', name: 'Primeiro capítulo', desc: 'Conclua seu primeiro livro', test: (s) => s.finished >= 1 },
  { id: 'book-5', icon: '📚', name: 'Pilha crescente', desc: 'Conclua 5 livros', test: (s) => s.finished >= 5 },
  { id: 'book-10', icon: '🏛️', name: 'Biblioteca pessoal', desc: 'Conclua 10 livros', test: (s) => s.finished >= 10 },
  { id: 'book-25', icon: '🦉', name: 'Coruja sábia', desc: 'Conclua 25 livros', test: (s) => s.finished >= 25 },
  { id: 'book-50', icon: '👑', name: 'Rei da estante', desc: 'Conclua 50 livros', test: (s) => s.finished >= 50 },
  { id: 'pages-1k', icon: '📄', name: 'Mil páginas', desc: 'Leia 1.000 páginas', test: (s) => s.totalPages >= 1000 },
  { id: 'pages-5k', icon: '📜', name: 'Pergaminho', desc: 'Leia 5.000 páginas', test: (s) => s.totalPages >= 5000 },
  { id: 'pages-10k', icon: '🗻', name: 'Montanha de papel', desc: 'Leia 10.000 páginas', test: (s) => s.totalPages >= 10000 },
  { id: 'streak-3', icon: '🔥', name: 'Aquecendo', desc: 'Leia 3 dias seguidos', test: (s) => s.longest >= 3 },
  { id: 'streak-7', icon: '📅', name: 'Semana perfeita', desc: 'Leia 7 dias seguidos', test: (s) => s.longest >= 7 },
  { id: 'streak-30', icon: '💪', name: 'Hábito de ferro', desc: 'Leia 30 dias seguidos', test: (s) => s.longest >= 30 },
  { id: 'streak-100', icon: '🚀', name: 'Imparável', desc: 'Leia 100 dias seguidos', test: (s) => s.longest >= 100 },
  { id: 'note-1', icon: '✍️', name: 'Primeira anotação', desc: 'Crie sua primeira nota', test: (s) => s.notes >= 1 },
  { id: 'note-50', icon: '🗒️', name: 'Marginália', desc: 'Crie 50 notas', test: (s) => s.notes >= 50 },
  { id: 'ocr-1', icon: '📷', name: 'Caçador de grifos', desc: 'Capture um trecho com OCR', test: (s) => s.ocrNotes >= 1 },
  { id: 'ocr-25', icon: '🔦', name: 'Marca-texto digital', desc: 'Capture 25 trechos com OCR', test: (s) => s.ocrNotes >= 25 },
  { id: 'brick', icon: '🧱', name: 'Tijolão', desc: 'Conclua um livro com 500+ páginas', test: (s) => s.maxBookPages >= 500 },
  { id: 'marathon', icon: '🏃', name: 'Maratona', desc: 'Leia 100 páginas em um único dia', test: (s) => s.maxDay >= 100 },
  { id: 'eclectic', icon: '🎨', name: 'Eclético', desc: 'Conclua livros de 5 temas diferentes', test: (s) => s.genres.size >= 5 },
  { id: 'critic', icon: '⭐', name: 'Crítico literário', desc: 'Avalie 10 livros', test: (s) => s.rated.length >= 10 },
  { id: 'link-1', icon: '🔗', name: 'Primeira conexão', desc: 'Ligue uma nota a outra ideia com [[ ]]', test: (s) => s.linkedNotes >= 1 },
  { id: 'link-25', icon: '🕸️', name: 'Rede de ideias', desc: 'Crie 25 notas conectadas', test: (s) => s.linkedNotes >= 25 },
  { id: 'card-1', icon: '🧠', name: 'Primeiro card', desc: 'Crie um card de memorização', test: (s) => s.cards >= 1 },
  { id: 'review-100', icon: '🐘', name: 'Memória de elefante', desc: 'Faça 100 revisões de cards', test: (s) => s.reviews >= 100 },
  { id: 'review-1000', icon: '🏛️', name: 'Palácio da memória', desc: 'Faça 1.000 revisões de cards', test: (s) => s.reviews >= 1000 },
  { id: 'study-3', icon: '🎓', name: 'Estudioso', desc: 'Conclua 3 livros profissionais ou acadêmicos', test: (s) => s.studyBooks >= 3 },
  { id: 'goal', icon: '🏆', name: 'Meta cumprida', desc: 'Bata sua meta anual de livros', test: (s) => s.yearGoal > 0 && s.finishedThisYear >= s.yearGoal },
];

const CHALLENGES = [
  { id: 'days5', text: 'Leia em 5 dias diferentes', target: 5, value: (w) => w.days },
  { id: 'pages150', text: 'Leia 150 páginas', target: 150, value: (w) => w.pages },
  { id: 'notes3', text: 'Crie 3 anotações', target: 3, value: (w) => w.notes },
  { id: 'day40', text: 'Leia 40 páginas em um único dia', target: 40, value: (w) => w.maxDay },
  { id: 'ocr2', text: 'Capture 2 grifos com OCR', target: 2, value: (w) => w.ocr },
  { id: 'review30', text: 'Revise 30 cards', target: 30, value: (w) => w.reviews },
  { id: 'links3', text: 'Crie 3 notas com conexões [[ ]]', target: 3, value: (w) => w.links },
  { id: 'days7', text: 'Leia todos os dias da semana', target: 7, value: (w) => w.days },
];

// Um desafio diferente por semana, sorteado de forma determinística pela data
export function weeklyChallenge(s) {
  const idx = Math.floor(parseYmd(s.week.start).getTime() / (7 * 864e5)) % CHALLENGES.length;
  const c = CHALLENGES[(idx + CHALLENGES.length) % CHALLENGES.length];
  const v = c.value(s.week);
  return { ...c, key: s.week.start, value: Math.min(v, c.target), done: v >= c.target };
}
