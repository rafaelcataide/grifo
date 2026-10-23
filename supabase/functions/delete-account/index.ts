// Função "delete-account": apaga a conta de quem pediu e, em cascata, todos os dados dela
// (registros sincronizados, perfil, participação em clubes, uso de IA). Exigência da LGPD e da Play Store.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

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

  // quem está pedindo: só a própria pessoa pode apagar a própria conta
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "faça login" }, 401);

  let confirm = "";
  try {
    ({ confirm } = await req.json());
  } catch { /* sem corpo */ }
  if (confirm !== "EXCLUIR") return json({ error: "confirmação ausente" }, 400);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "falha ao excluir", message: error.message }, 500);
  return json({ deleted: true });
});
