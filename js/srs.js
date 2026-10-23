// Repetição espaçada (variação simples do SM-2, o algoritmo do Anki).
import { addDays } from './game.js';

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

// Lacunas: {{texto}} vira [ … ] na pergunta e fica destacado na resposta
export const clozeQuestion = (html) => html.replace(/\{\{(.+?)\}\}/g, '<span class="cloze">[ … ]</span>');
export const clozeAnswer = (html) => html.replace(/\{\{(.+?)\}\}/g, '<mark>$1</mark>');
