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

As cotas de IA de cada plano (por mês, separadas em **IA rápida** e **IA avançada**, mais um teto diário) ficam em `supabase/functions/_shared/planos.js`: o app mostra, a função `ai` faz valer. Para mudar os números, edite esse arquivo, publique o app e rode `supabase functions deploy ai`.

| Plano | IA rápida / mês | IA avançada / mês | Teto por dia | Artigos e PDFs | PDFs na conta |
|---|---|---|---|---|---|
| Grátis | 20 | 3 no total (para experimentar) | 20 | 10 | — |
| Plus | 1.000 | 12 | 100 | ilimitados | 2 GB |
| Pro | 2.000 | 30 | 200 | ilimitados | 10 GB |

Opções (também com `supabase secrets set`):
- `AI_GLOBAL_DAILY_LIMIT=500`: teto de pedidos de IA por dia somando todas as pessoas
- `AI_FOR_ALL=true`: trata todos como Pro (para testes)

A IA usa o modelo Claude Opus 5.5. Os pedidos são cobrados na sua conta da Anthropic.

## 5. Planos Plus e Pro e pagamentos (opcional)

**Para liberar um plano para você mesmo** (sem pagamento), rode no SQL Editor (`'plus'` ou `'pro'`):

```sql
update public.profiles set plan = 'pro'
where user_id = (select id from auth.users where email = 'seu-email@gmail.com');
```

**Para vender assinaturas com o Stripe:**

1. No Stripe, crie dois **produtos** (Plus e Pro), cada um com dois preços recorrentes (mensal e anual), e um **Payment Link** para cada preço (4 links).
2. Cole os links em `config.js` → `checkout` (`plus.month`, `plus.year`, `pro.month`, `pro.year`) e ajuste `prices` se mudar os valores. O app envia o id do usuário no link automaticamente.
3. Em **Settings → Billing → Customer portal**, ative o portal do cliente (trocar de plano, cartão e cancelar) e cole o link de login em `config.js` → `billingPortalUrl`. Quem já assina troca de plano por ali, sem ficar com duas assinaturas.
4. Cadastre os segredos. `STRIPE_PRO_PRICES` são os ids dos **dois preços do Pro** (`price_...`), separados por vírgula: é assim que o servidor sabe se a pessoa comprou Plus ou Pro.

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_PRO_PRICES=price_proMensal,price_proAnual
```

5. Publique a função que recebe os avisos do Stripe:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

6. No Stripe, em **Developers → Webhooks**, adicione o endpoint `https://SEU-PROJETO.supabase.co/functions/v1/stripe-webhook` com os eventos `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted`. O segredo `whsec_...` aparece ali.

Quando alguém paga, o plano vira `plus` ou `pro` (pelo preço) em instantes; trocas de plano pelo portal também chegam; se a assinatura for cancelada, volta para `free`.

## 6. Notificações, e-mail semanal e exclusão de conta

**Funções** (já publicadas no projeto do Grifo; num projeto novo, publique-as):

```bash
npx supabase functions deploy delete-account --use-api
```

```bash
npx supabase functions deploy push-daily --use-api --no-verify-jwt
```

```bash
npx supabase functions deploy weekly-email --use-api --no-verify-jwt
```

**Notificações (Web Push).** Gere um par de chaves com `npx web-push generate-vapid-keys`, coloque a pública em `config.js` → `vapidPublicKey` e a privada nos segredos:

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=https://seu-site/ CRON_SECRET=um-texto-aleatorio-longo
```

Depois, no SQL Editor, agende a função a cada 15 minutos (troque o projeto e o segredo):

```sql
select cron.schedule('grifo-push-daily', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/push-daily',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'O-MESMO-CRON_SECRET'),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
$$);
```

**Resumo semanal por e-mail.** Crie uma conta no https://resend.com, verifique um domínio seu (ex.: `grifo.app`) e configure:

```bash
npx supabase secrets set RESEND_API_KEY=re_... EMAIL_FROM="Grifo <resumo@seu-dominio>"
```

E agende para domingo 9h (horário de Brasília = 12h UTC) do mesmo jeito, com o nome `grifo-weekly-email`, a URL `.../functions/v1/weekly-email` e o horário `0 12 * * 0`. Sem `RESEND_API_KEY`, a função não envia nada.

**Ver sugestões e erros dos usuários:** no Supabase, **Table Editor → feedback** e **client_errors**.

## 7. Proteções extras (recomendado antes de divulgar)

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

## 8. Convites e painel de métricas

Rode `migrations/20261025_crescimento.sql` (já aplicado neste projeto). Ele cria:

- **Convites:** cada conta tem um link `?convite=CÓDIGO` (em Conta → Convide amigos). Quem cria conta por ele e quem convidou ganham 30 dias de Plus (quem convida, no máximo 12 vezes). Só contas com até 3 dias podem usar um convite.
- **Eventos de uso:** artes compartilhadas, convites enviados e visitas ao Plus, sem conteúdo das notas.
- **Painel em `#/admin`:** usuários, ativação, retenção, compartilhamento, Plus e cadastros por semana. Só aparece para quem está na tabela `admins` (o e-mail do dono já foi incluído). Para dar acesso a outra pessoa: `insert into public.admins select id from auth.users where email = 'pessoa@exemplo.com';`

O endereço que aparece nas artes e nos convites vem de `siteUrl` em `config.js`; troque quando tiver um domínio próprio.

## 9. Artigos salvos por link

Rode `migrations/20261026_artigos.sql` e publique a função: `npx supabase functions deploy article`. Ela baixa a página do link e devolve só o texto (modo leitura). Só aceita endereços públicos `http(s)` (nunca rede interna), páginas de até 3 MB e 60 artigos por pessoa por dia (`ARTICLE_DAILY_LIMIT` muda o limite). No plano grátis o app guarda até 10 artigos.

## Segurança

- A chave `anon` é pública por natureza; quem protege os dados são as regras **RLS** do `schema.sql`: cada pessoa só lê e grava os próprios registros.
- O plano (`plan`) só pode ser alterado pelo servidor (função do Stripe ou SQL), nunca pelo app, e nem é visível para outras pessoas (assim como o cliente do Stripe).
- Os contadores de uso da IA só podem ser incrementados pela função do servidor.
- As chaves pessoais (Google Livros, Anthropic do modo pessoal) **não** são enviadas à nuvem na sincronização.
- O perfil público mostra só estatísticas e títulos de livros; notas e grifos nunca são publicados.
