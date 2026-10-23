// Função "push-daily": chamada a cada 15 minutos pelo agendador do banco (pg_cron).
// Para cada inscrição cujo horário de lembrete já passou hoje (no fuso da pessoa), envia uma notificação:
// manter a sequência, revisar cards ou o "grifo do dia". Uma por dia por aparelho.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { digestFor, localNow } from "../_shared/digest.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("proibido", { status: 403 });

  const { data: subs, error } = await admin.from("push_subscriptions").select("*").eq("enabled", true);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, removed = 0;
  const cache = new Map<string, Awaited<ReturnType<typeof digestFor>>>();
  for (const sub of subs || []) {
    const { date, minutes } = localNow(sub.tz || "America/Sao_Paulo");
    const [h, m] = String(sub.remind_time || "20:00").split(":").map(Number);
    if (sub.last_sent === date || minutes < h * 60 + m) continue;

    const key = `${sub.user_id}|${date}`;
    if (!cache.has(key)) cache.set(key, await digestFor(admin, sub.user_id, date));
    const d = cache.get(key)!;
    const quote = d.highlight ? `“${clip(d.highlight.text, 110)}” — ${d.highlight.book}` : "";

    let title: string, body: string, url = "./#/";
    if (!d.readToday) {
      title = d.streak ? `🔥 Não perca sua sequência de ${d.streak} ${d.streak === 1 ? "dia" : "dias"}!` : "📚 Hora da leitura";
      body = quote || "Que tal algumas páginas hoje?";
    } else if (d.dueCards) {
      title = `🧠 ${d.dueCards} ${d.dueCards === 1 ? "card" : "cards"} para revisar`;
      body = "Leva poucos minutos e fixa o que você leu.";
      url = "./#/revisar";
    } else if (quote) {
      title = "🖍️ Seu grifo do dia";
      body = quote;
    } else {
      await admin.from("push_subscriptions").update({ last_sent: date }).eq("endpoint", sub.endpoint);
      continue;
    }

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, url }),
        { TTL: 6 * 3600, urgency: "normal" },
      );
      sent++;
      await admin.from("push_subscriptions").update({ last_sent: date }).eq("endpoint", sub.endpoint);
    } catch (e) {
      // aparelho desinstalou ou revogou a permissão: a inscrição não vale mais
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        removed++;
      }
    }
  }
  return new Response(JSON.stringify({ checked: subs?.length || 0, sent, removed }), { headers: { "Content-Type": "application/json" } });
});
