# Ligando o Grifo ao servidor (Supabase)

Sem servidor, o Grifo funciona em **modo pessoal**: tudo fica no aparelho e todos os recursos estão liberados. Com o servidor você ganha:

- **Login com Google** (Gmail) ou com código por e-mail
- **Sincronização** entre celular e computador (e backup automático na nuvem)
- **Clubes de leitura**, ranking semanal e **perfil público**
- **IA pelo servidor**, sem cada pessoa precisar de chave própria, com o plano **Plus**
- **Pagamento do Plus** pelo Stripe (opcional)

Tudo cabe no plano gratuito do Supabase para começar.

---

## 1. Criar o projeto

1. Crie uma conta em https://supabase.com e um **New project** (região São Paulo).
2. Em **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. Cole as duas em `config.js`:

```js
supabaseUrl: 'https://SEU-PROJETO.supabase.co',
supabaseAnonKey: 'eyJ...',
```

## 2. Login com Google (Gmail)

1. No **Google Cloud Console** (https://console.cloud.google.com):
   - Crie um projeto, abra **APIs e serviços → Tela de consentimento OAuth** e preencha o nome do app (Grifo) e o seu e-mail.
   - Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web**.
   - Em **URIs de redirecionamento autorizados**, adicione: `https://SEU-PROJETO.supabase.co/auth/v1/callback`
   - Copie o **ID do cliente** e a **Chave secreta**.
2. No Supabase, em **Authentication → Sign In / Providers → Google**, ative e cole o ID e a chave.
3. Em **Authentication → URL Configuration**:
   - **Site URL**: o endereço onde o app está publicado (ex.: `https://seu-usuario.github.io/grifo/`)
   - **Redirect URLs**: adicione também `http://localhost:5180/` para testar no computador.

## 3. Login por código no e-mail (opcional)

Em **Authentication → Emails → Magic Link**, troque o modelo para enviar o código:

```html
<h2>Seu código do Grifo</h2>
<p>Digite este código no app: <b>{{ .Token }}</b></p>
```

## 4. IA pelo servidor

Precisa da [Supabase CLI](https://supabase.com/docs/guides/cli) e de uma chave da Anthropic (https://console.anthropic.com → API Keys).

```bash
supabase login
```

```bash
supabase link --project-ref SEU-PROJETO
```

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

```bash
supabase functions deploy ai
```

Opções (também com `supabase secrets set`):
- `AI_DAILY_LIMIT=60`: pedidos de IA por pessoa por dia (padrão 60)
- `AI_FOR_ALL=true`: libera a IA para todos os usuários logados, não só para o Plus

A IA usa o modelo Claude Opus 5.5. Os pedidos são cobrados na sua conta da Anthropic.

## 5. Plano Plus e pagamentos (opcional)

**Para liberar o Plus para você mesmo** (sem pagamento), rode no SQL Editor:

```sql
update public.profiles set plan = 'plus'
where user_id = (select id from auth.users where email = 'seu-email@gmail.com');
```

**Para vender assinaturas com o Stripe:**

1. No Stripe, crie um **produto** com preço recorrente e um **Payment Link** para ele.
2. Cole o link em `config.js` → `plusCheckoutUrl` (e ajuste `plusPriceLabel`). O app envia o id do usuário no link automaticamente.
3. Publique a função que recebe os avisos do Stripe:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
```

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

4. No Stripe, em **Developers → Webhooks**, adicione o endpoint `https://SEU-PROJETO.supabase.co/functions/v1/stripe-webhook` com os eventos `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted`. O segredo `whsec_...` aparece ali.

Quando alguém paga, o plano vira `plus` em instantes; se a assinatura for cancelada, volta para `free`.

## 6. Proteções extras (recomendado antes de divulgar)

**CAPTCHA no login por e-mail** (barra contas criadas por robôs; o login com Google não precisa):

1. Em https://dash.cloudflare.com → **Turnstile → Add widget**: nome "Grifo", domínios `rafaelcataide.github.io` e `localhost`, modo **Managed**.
2. Copie a **Site Key** (pública) para `config.js` → `turnstileSiteKey` e publique o app.
3. Só depois disso, no Supabase: **Authentication → Attack Protection → Enable CAPTCHA protection**, provedor **Turnstile**, cole a **Secret Key**.

A ordem importa: se o CAPTCHA for ligado no Supabase antes do app ter a Site Key, o login por e-mail para de funcionar.

**Teto de gastos da IA** (três camadas):

1. **Na Anthropic** (a mais importante): https://console.anthropic.com → **Settings → Limits** → defina um **limite mensal de gastos** (ex.: US$ 20). Ao atingir, a API para de cobrar.
2. **Por pessoa por dia**: `AI_DAILY_LIMIT` (padrão 60 pedidos).
3. **Do app inteiro por dia**: `AI_GLOBAL_DAILY_LIMIT` (padrão 500 pedidos somando todos os usuários):

```bash
npx supabase secrets set AI_GLOBAL_DAILY_LIMIT=200
```

**Google**: no Google Cloud, em **Tela de consentimento OAuth**, clique em **Publicar app**. Em modo "Teste" só os e-mails cadastrados como testadores conseguem entrar.

**Conferir a segurança do banco** a qualquer momento:

```bash
npx supabase db advisors --linked
```

Os avisos restantes esperados são das funções que o próprio usuário logado chama (`push_records`, `join_club`, `my_plan`, `is_member`, `shares_club`) e o de senha vazada, que não se aplica (o app não usa senha).

---

## Segurança

- A chave `anon` é pública por natureza; quem protege os dados são as regras **RLS** do `schema.sql`: cada pessoa só lê e grava os próprios registros.
- O plano (`plan`) só pode ser alterado pelo servidor (função do Stripe ou SQL), nunca pelo app, e nem é visível para outras pessoas (assim como o cliente do Stripe).
- Os contadores de uso da IA só podem ser incrementados pela função do servidor.
- As chaves pessoais (Google Livros, Anthropic do modo pessoal) **não** são enviadas à nuvem na sincronização.
- O perfil público mostra só estatísticas e títulos de livros; notas e grifos nunca são publicados.
