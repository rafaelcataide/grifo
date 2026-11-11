// Função "delete-account": apaga a conta de quem pediu e todos os dados dela. Exigência da LGPD e da Play Store.
// Ordem: 1) cancela a assinatura no Stripe (para a pessoa não continuar sendo cobrada); 2) apaga os PDFs
// enviados (arquivos não somem em cascata); 3) apaga o usuário, e o banco apaga em cascata os registros
// sincronizados, o perfil, a participação em clubes e os contadores de uso.
// Se um passo falhar, para ali e avisa: a conta continua existindo e a pessoa pode tentar de novo.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Cancela as assinaturas em aberto do cliente no Stripe. Sem cliente ou sem Stripe configurado, não há o que fazer.
async function cancelSubscriptions(customer: string) {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("pagamentos não configurados no servidor");
  const headers = { Authorization: `Bearer ${key}` };
  const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100`, { headers });
  if (res.status === 404) return 0; // cliente não existe mais no Stripe
  if (!res.ok) throw new Error(`Stripe respondeu ${res.status}`);
  const { data } = await res.json();
  let n = 0;
  for (const sub of data || []) {
    if (["canceled", "incomplete_expired"].includes(sub.status)) continue;
    const del = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, { method: "DELETE", headers });
    if (!del.ok) throw new Error(`Stripe respondeu ${del.status} ao cancelar`);
    n++;
  }
  return n;
}

// Apaga todos os arquivos da pasta da pessoa no espaço de PDFs
async function removePdfs(uid: string) {
  let n = 0;
  for (;;) {
    const { data, error } = await admin.storage.from("pdfs").list(uid, { limit: 100 });
    if (error) throw new Error(error.message);
    if (!data?.length) return n;
    const { error: rmError } = await admin.storage.from("pdfs").remove(data.map((f) => `${uid}/${f.name}`));
    if (rmError) throw new Error(rmError.message);
    n += data.length;
  }
}

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

  const { data: prof } = await admin.from("profiles").select("stripe_customer").eq("user_id", user.id).maybeSingle();
  let canceled = 0, files = 0;
  if (prof?.stripe_customer) {
    try { canceled = await cancelSubscriptions(prof.stripe_customer); } catch (e) {
      console.error("delete-account: assinatura", (e as Error).message);
      return json({ error: "assinatura", message: "Não consegui cancelar sua assinatura agora, então a conta não foi excluída. Tente de novo em alguns minutos ou cancele a assinatura antes, em Conta." }, 502);
    }
  }
  try { files = await removePdfs(user.id); } catch (e) {
    console.error("delete-account: arquivos", (e as Error).message);
    return json({ error: "arquivos", message: "Não consegui apagar seus PDFs agora, então a conta não foi excluída. Tente de novo em alguns minutos." }, 502);
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "falha ao excluir", message: error.message }, 500);
  return json({ deleted: true, canceled, files });
});
