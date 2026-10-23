// Configuração do servidor (Supabase). Sem isso o app funciona em "modo pessoal": tudo só no aparelho.
// A chave "anon" do Supabase é pública por natureza (a segurança vem das regras RLS do banco).
// Passo a passo em supabase/LEIA-ME.md.
export const CONFIG = {
  supabaseUrl: '',          // ex.: 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',      // Project Settings → API → anon public

  // Grifo Plus (opcional): link de pagamento do Stripe (Payment Link) e o preço exibido
  plusCheckoutUrl: '',      // ex.: 'https://buy.stripe.com/xxxx'
  plusPriceLabel: 'R$ 9,90/mês',
};
