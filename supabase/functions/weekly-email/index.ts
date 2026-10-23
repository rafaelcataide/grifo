// Função "weekly-email": todo domingo de manhã (pg_cron), manda o resumo da semana para quem ativou.
// Usa o Resend (https://resend.com) para enviar. Sem RESEND_API_KEY e EMAIL_FROM configurados, não faz nada.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { digestFor, localNow } from "../_shared/digest.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_URL = Deno.env.get("APP_URL") ?? "https://rafaelcataide.github.io/grifo/";

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function html(name: string, d: Awaited<ReturnType<typeof digestFor>>) {
  const stat = (n: string | number, label: string) =>
    `<td style="padding:12px;text-align:center;background:#f1f0eb;border-radius:12px"><div style="font-size:24px;font-weight:800;color:#2d2f36">${n}</div><div style="font-size:12px;color:#7c7f8a">${label}</div></td>`;
  return `<!doctype html><html><body style="margin:0;background:#f7f6f2;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#2d2f36">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="font-size:22px;font-weight:700">🖍️ Grifo</div>
    <h1 style="font-size:22px;margin:16px 0 4px">${name ? `${esc(name)}, sua` : "Sua"} semana de leituras</h1>
    <p style="color:#7c7f8a;margin:0 0 16px">Os últimos 7 dias em números.</p>
    <table width="100%" cellspacing="8" style="border-collapse:separate"><tr>
      ${stat(d.weekPages, "páginas")}${stat(d.weekDays, "dias lendo")}${stat(`🔥 ${d.streak}`, "sequência")}${stat(d.weekNotes, "notas")}
    </tr></table>
    ${d.finishedWeek.length ? `<p>🏁 Você terminou: <b>${d.finishedWeek.map(esc).join("</b>, <b>")}</b>. Parabéns!</p>` : ""}
    ${d.reading.length ? `<p style="margin-bottom:4px"><b>Lendo agora</b></p><ul style="margin-top:0">${d.reading.map((b) => `<li>${esc(b.title)}${b.pages ? ` — ${Math.round((b.currentPage / b.pages) * 100)}%` : ""}</li>`).join("")}</ul>` : ""}
    ${d.highlight ? `<div style="background:#fff;border-left:4px solid #ffd66b;padding:14px 16px;border-radius:8px;margin:16px 0;font-family:Georgia,serif;font-size:17px;line-height:1.5">“${esc(d.highlight.text)}”<div style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#7c7f8a;margin-top:8px">— ${esc(d.highlight.book)}${d.highlight.author ? `, ${esc(d.highlight.author)}` : ""}</div></div>` : ""}
    ${d.dueCards ? `<p>🧠 Você tem <b>${d.dueCards} cards</b> esperando revisão.</p>` : ""}
    <p style="margin:24px 0"><a href="${APP_URL}" style="background:#6f7fe8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">Abrir o Grifo</a></p>
    <p style="font-size:12px;color:#7c7f8a">Você recebe este e-mail porque ativou o resumo semanal. Para parar, desative em Conta → Resumo semanal por e-mail.</p>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("proibido", { status: 403 });
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("EMAIL_FROM");
  if (!key || !from) return Response.json({ skipped: "configure RESEND_API_KEY e EMAIL_FROM" });

  const { data: profiles, error } = await admin.from("profiles").select("user_id, display_name").eq("weekly_email", true);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, skipped = 0;
  for (const p of profiles || []) {
    const { data: { user } } = await admin.auth.admin.getUserById(p.user_id);
    if (!user?.email) { skipped++; continue; }
    const d = await digestFor(admin, p.user_id, localNow("America/Sao_Paulo").date);
    if (!d.weekPages && !d.weekNotes && !d.highlight) { skipped++; continue; } // nada para contar ainda
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: user.email,
        subject: d.weekPages ? `📚 ${d.weekPages} páginas nesta semana` : "🖍️ Seu resumo de leituras da semana",
        html: html((p.display_name || "").split(" ")[0], d),
      }),
    });
    if (res.ok) sent++; else skipped++;
  }
  return Response.json({ sent, skipped });
});
