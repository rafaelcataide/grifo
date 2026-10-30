// Função "stripe-webhook": o Stripe avisa pagamentos e cancelamentos; aqui o plano do usuário é ajustado.
// O Payment Link é aberto pelo app com client_reference_id = id do usuário no Supabase.
import Stripe from "npm:stripe@22.6.2";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();
// service role: única forma de alterar a coluna "plan"
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Preços do Pro (mensal e anual): ids do Stripe em STRIPE_PRO_PRICES, separados por vírgula. Qualquer outro preço é Plus.
const PRO_PRICES = (Deno.env.get("STRIPE_PRO_PRICES") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const planOfPrices = (ids: (string | undefined)[]) => (ids.some((id) => id && PRO_PRICES.includes(id)) ? "pro" : "plus");

async function setPlan(match: { user_id?: string; stripe_customer?: string }, plan: "free" | "plus" | "pro", customer?: string) {
  const patch: Record<string, unknown> = { plan, updated_at: new Date().toISOString() };
  if (customer) patch.stripe_customer = customer;
  if (match.user_id) {
    // o perfil pode ainda não existir se a pessoa pagou antes de abrir o app logada
    await admin.from("profiles").upsert({ user_id: match.user_id, ...patch }, { onConflict: "user_id" });
  } else if (match.stripe_customer) {
    await admin.from("profiles").update(patch).eq("stripe_customer", match.stripe_customer);
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  if (!signature) return new Response("sem assinatura", { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`assinatura inválida: ${(e as Error).message}`, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (!s.client_reference_id) break;
      // qual plano foi comprado: pelo preço dos itens do checkout
      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 10 });
      const plan = planOfPrices(items.data.map((i) => i.price?.id));
      await setPlan({ user_id: s.client_reference_id }, plan, typeof s.customer === "string" ? s.customer : undefined);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await setPlan({ stripe_customer: String(sub.customer) }, "free");
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const active = ["active", "trialing", "past_due"].includes(sub.status);
      // troca de plano (Plus ⇄ Pro) também chega aqui
      await setPlan({ stripe_customer: String(sub.customer) }, active ? planOfPrices(sub.items.data.map((i) => i.price?.id)) : "free");
      break;
    }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
