// Função "ai" (Supabase Edge Function): chama o Claude com a chave guardada no servidor.
// Usuários logados, com cota por plano (grátis, Plus, Pro): IA leve e pesada por mês, e um teto diário.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { buildParams, parseResult, TASK_NAMES, taskKind } from "../_shared/ai-tasks.js";
import { planoDe, periodoDe } from "../_shared/planos.js";

// teto somando todos os usuários: mesmo com muitas contas, o gasto diário tem limite
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get("AI_GLOBAL_DAILY_LIMIT") ?? "500");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // lê ANTHROPIC_API_KEY dos segredos da função
// contadores de uso: só a chave de serviço pode incrementá-los (usuários não chamam direto)
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "faça login" }, 401);

  let task: string, input: Record<string, unknown>;
  try {
    ({ task, input } = await req.json());
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }
  if (!TASK_NAMES.includes(task)) return json({ error: "tarefa desconhecida" }, 400);

  // plano e cota: o servidor decide (o app só mostra); AI_FOR_ALL=true trata todos como Pro (testes)
  const { data: planRow } = await admin.rpc("plan_of", { uid: user.id });
  const plan = Deno.env.get("AI_FOR_ALL") === "true" ? "pro" : (planRow as string) || "free";
  const limits = planoDe(plan);
  const kind = taskKind(task);
  const period = periodoDe(plan, kind);
  const cap = kind === "heavy" ? limits.heavy : limits.light;

  const { data: used, error: quotaError } = await admin.rpc("ai_quota_hit", { uid: user.id });
  if (quotaError) return json({ error: "falha ao registrar uso" }, 500);
  if (used > limits.daily) return json({ error: "limite", message: `Limite de ${limits.daily} pedidos de IA por dia atingido.` }, 429);
  const { data: total, error: globalError } = await admin.rpc("ai_global_hit");
  if (globalError) return json({ error: "falha ao registrar uso" }, 500);
  if (total > GLOBAL_DAILY_LIMIT) return json({ error: "limite", message: "A IA atingiu o limite de uso de hoje. Tente amanhã." }, 429);
  const { data: count, error: monthError } = await admin.rpc("ai_month_hit", { uid: user.id, kind, per: period, lim: cap });
  if (monthError) return json({ error: "falha ao registrar uso" }, 500);
  if (count === -1) {
    const message = kind === "heavy"
      ? (limits.heavyTotal ? "Você já usou os 3 testes de IA avançada (perguntar, fichamento, recomendações)." : `Você usou os ${cap} usos de IA avançada deste mês.`)
      : `Você usou os ${cap} usos de IA deste mês.`;
    return json({ error: "cota", kind, plan, message }, 429);
  }

  // profundidade: o Pro lê mais notas no "Perguntar" e no fichamento
  const params = buildParams(task, { ...input, depth: plan === "pro" ? "pro" : "std" });
  try {
    const message = await anthropic.beta.messages.create(params);
    return json(parseResult(message));
  } catch (e) {
    await admin.rpc("ai_month_refund", { uid: user.id, kind, per: period }); // falha do serviço não gasta cota
    if (e instanceof Anthropic.RateLimitError) return json({ error: "ocupado", message: "A IA está ocupada. Tente em instantes." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "ia", message: `Erro da IA (${e.status}).` }, 502);
    return json({ error: "ia", message: (e as Error).message }, 500);
  }
});
