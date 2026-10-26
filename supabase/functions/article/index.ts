// Função "article": recebe o link de um artigo, baixa a página e devolve o texto limpo
// (sem menus e anúncios), como o modo leitura do Firefox. Só para quem está logado, com limite diário.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { fetchArticle, safeUrl } from "../_shared/article.ts";

const DAILY_LIMIT = Number(Deno.env.get("ARTICLE_DAILY_LIMIT") ?? "60");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "login", message: "Entre na sua conta para salvar artigos." }, 401);

  let raw = "";
  try { ({ url: raw } = await req.json()); } catch { return json({ error: "corpo inválido" }, 400); }
  const url = safeUrl(String(raw || "").trim());
  if (!url) return json({ error: "link", message: "Link inválido. Cole o endereço completo, começando com https://" }, 400);

  const { data: used, error: qErr } = await admin.rpc("article_quota_hit", { uid: user.id });
  if (qErr) return json({ error: "falha ao registrar uso" }, 500);
  if (used > DAILY_LIMIT) return json({ error: "limite", message: `Limite de ${DAILY_LIMIT} artigos por dia atingido.` }, 429);

  try {
    return json(await fetchArticle(url));
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "A página demorou demais para responder." : (e as Error).message;
    return json({ error: "busca", message: msg || "Não consegui abrir esse link." }, 502);
  }
});
