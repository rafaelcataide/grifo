// Função "ai" (Supabase Edge Function): chama o Claude com a chave guardada no servidor.
// Só para usuários logados com plano Plus (ou todos, se AI_FOR_ALL=true), com limite diário.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { buildParams, parseResult, TASK_NAMES } from "../_shared/ai-tasks.js";

const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "60");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // lê ANTHROPIC_API_KEY dos segredos da função

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "faça login" }, 401);

  if (Deno.env.get("AI_FOR_ALL") !== "true") {
    const { data: profile } = await supabase.from("profiles").select("plan").eq("user_id", user.id).maybeSingle();
    if (profile?.plan !== "plus") return json({ error: "plus", message: "A IA faz parte do Grifo Plus." }, 402);
  }

  let task: string, input: unknown;
  try {
    ({ task, input } = await req.json());
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }
  if (!TASK_NAMES.includes(task)) return json({ error: "tarefa desconhecida" }, 400);

  const { data: used, error: quotaError } = await supabase.rpc("ai_quota_hit");
  if (quotaError) return json({ error: "falha ao registrar uso" }, 500);
  if (used > DAILY_LIMIT) return json({ error: "limite", message: `Limite de ${DAILY_LIMIT} pedidos de IA por dia atingido.` }, 429);

  try {
    const message = await anthropic.beta.messages.create(buildParams(task, input));
    return json(parseResult(message));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "ocupado", message: "A IA está ocupada. Tente em instantes." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "ia", message: `Erro da IA (${e.status}).` }, 502);
    return json({ error: "ia", message: (e as Error).message }, 500);
  }
});
