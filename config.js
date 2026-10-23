// Configuração do servidor (Supabase). Sem isso o app funciona em "modo pessoal": tudo só no aparelho.
// A chave "anon" do Supabase é pública por natureza (a segurança vem das regras RLS do banco).
// Passo a passo em supabase/LEIA-ME.md.
export const CONFIG = {
  supabaseUrl: 'https://lrjvkcehqeeogakistkz.supabase.co',          // ex.: 'https://abcdefgh.supabase.co'
  // CAPTCHA do login por e-mail (Cloudflare Turnstile): chave do site, pública. Vazio = sem CAPTCHA.
  turnstileSiteKey: '',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyanZrY2VocWVlb2dha2lzdGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3Njc3ODIsImV4cCI6MjEwODM0Mzc4Mn0.XMno5EPqLS1_yA0mYfdJpJRIC-gpwfAQQEAh3HkHoJ4',      // Project Settings → API → anon public

  // Grifo Plus (opcional): link de pagamento do Stripe (Payment Link) e o preço exibido
  plusCheckoutUrl: '',      // ex.: 'https://buy.stripe.com/xxxx'
  plusPriceLabel: 'R$ 9,90/mês',

  // Notificações pelo servidor (Web Push): chave pública VAPID. A privada fica nos segredos do Supabase.
  vapidPublicKey: 'BAhy9Vh7RB6IzNVvEQTW1uzcwkas_v4hRst-x7A6LQOczJ6Hd5KLLlZlYD7FzocPWApuSGzgeW_WHAX8jC53pTE',

  // Contato mostrado na política de privacidade (LGPD). Vazio = só o botão "Enviar sugestão".
  contactEmail: '',
};
