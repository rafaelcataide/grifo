// Repetição espaçada (variação simples do SM-2, o algoritmo do Anki).
import { addDays, parseYmd } from './game.js';

export const GRADES = [
  { g: 0, label: 'Errei', cls: 'again', key: '1' },
  { g: 1, label: 'Difícil', cls: 'hard', key: '2' },
  { g: 2, label: 'Bom', cls: 'good', key: '3' },
  { g: 3, label: 'Fácil', cls: 'easy', key: '4' },
];

export function newCard(fields, today) {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today, ...fields };
}

export function schedule(card, g, today) {
  const c = { ...card };
  if (g === 0) {
    c.reps = 0;
    c.lapses = (c.lapses || 0) + 1;
    c.interval = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = today;
  } else {
    c.reps++;
    if (c.reps === 1) c.interval = g === 3 ? 3 : 1;
    else if (c.reps === 2) c.interval = g === 1 ? 3 : g === 2 ? 6 : 8;
    else c.interval = Math.max(c.interval + 1, Math.round(c.interval * c.ease * (g === 1 ? 0.8 : g === 3 ? 1.3 : 1)));
    c.ease = Math.max(1.3, c.ease + (g === 1 ? -0.15 : g === 3 ? 0.15 : 0));
    c.due = addDays(today, c.interval);
  }
  c.lastReview = today;
  return c;
}

export function intervalLabel(card, g, today) {
  const n = schedule(card, g, today).interval;
  if (n === 0) return 'agora';
  if (n === 1) return '1 dia';
  if (n < 30) return `${n} dias`;
  if (n < 365) return `${Math.round(n / 30)} m`;
  return `${(n / 365).toFixed(1)} a`;
}

// ---------- plano de prova ----------
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);

// O que revisar hoje para chegar à prova com tudo visto: os cards que voltariam antes da data,
// divididos pelos dias que faltam (os atrasados entram todos).
export function examPlan(cards, examDate, today) {
  const daysLeft = daysBetween(today, examDate);
  // (card revisado hoje não volta hoje: só os que ainda não foram vistos hoje entram na meta)
  const pending = cards.filter((c) => c.due < examDate && (c.due <= today || c.lastReview !== today)).sort((a, b) => a.due.localeCompare(b.due) || (a.createdAt || 0) - (b.createdAt || 0));
  const overdue = pending.filter((c) => c.due <= today).length;
  const goal = daysLeft > 0 ? Math.min(pending.length, Math.max(overdue, Math.ceil(pending.length / daysLeft))) : 0;
  return {
    daysLeft,
    total: cards.length,
    learned: cards.filter((c) => c.reps > 0).length,
    goal,
    queue: pending.slice(0, goal).map((c) => c.id),
  };
}

// Card que só voltaria depois da prova é puxado para a véspera (revisão final)
export function capForExam(card, examDate, today) {
  const eve = addDays(examDate, -1);
  if (eve > today && card.due > eve) return { ...card, due: eve };
  return card;
}

// Lacunas: {{texto}} vira [ … ] na pergunta e fica destacado na resposta
export const clozeQuestion = (html) => html.replace(/\{\{(.+?)\}\}/g, '<span class="cloze">[ … ]</span>');
export const clozeAnswer = (html) => html.replace(/\{\{(.+?)\}\}/g, '<mark>$1</mark>');
