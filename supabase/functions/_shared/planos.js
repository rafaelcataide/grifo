// Planos do Grifo: limites usados pelo app (mostrar e avisar) e pela função "ai" (fazer valer).
// IA leve = tarefas rápidas no Haiku (custam centavos de centavo); IA pesada = Sonnet (perguntar,
// fichamento, recomendações), que é o que pesa no custo. No grátis, a pesada é só para experimentar.
export const PLANOS = {
  free: { nome: 'Grátis', light: 20, heavy: 3, heavyTotal: true, daily: 20, articles: 10, pdfGB: 0 },
  plus: { nome: 'Plus', light: 1000, heavy: 12, heavyTotal: false, daily: 100, articles: Infinity, pdfGB: 2 },
  pro: { nome: 'Pro', light: 2000, heavy: 30, heavyTotal: false, daily: 200, articles: Infinity, pdfGB: 10 },
};

export const planoDe = (plan) => PLANOS[plan] || PLANOS.free;

// período da cota: o mês corrente ('2026-10') ou 'total' (teste de IA pesada do grátis, para sempre)
export const periodoDe = (plan, kind, now = new Date()) =>
  (kind === 'heavy' && planoDe(plan).heavyTotal ? 'total' : now.toISOString().slice(0, 7));
