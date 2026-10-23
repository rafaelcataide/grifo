# Publicando o Grifo na Play Store

O Grifo já é um app instalável (PWA). Para aparecer na Play Store, ele é "embrulhado" num app Android leve
(Trusted Web Activity) gerado pelo **PWABuilder**, sem reescrever nada. O app da loja abre o mesmo site e
recebe as atualizações automaticamente: você só republica na loja se mudar ícone, nome ou permissões.

## O que você precisa
- Conta de desenvolvedor no **Google Play Console**: https://play.google.com/console (taxa única de US$ 25).
- O app publicado com HTTPS (já está em `https://rafaelcataide.github.io/grifo/`).
- Política de privacidade com link público (já existe: `https://rafaelcataide.github.io/grifo/#/privacidade`)
  e exclusão de conta dentro do app (já existe em Conta → Excluir minha conta).

## Passo 1 — Gerar o pacote Android
1. Abra https://www.pwabuilder.com e cole `https://rafaelcataide.github.io/grifo/`.
2. Clique em **Package For Stores → Android → Generate Package**.
   - **Package ID**: `io.github.rafaelcataide.grifo` (não dá para mudar depois)
   - **App name**: Grifo · **Launcher name**: Grifo
   - **Signing key**: deixe "New" (o PWABuilder cria a chave). **Guarde o arquivo `.keystore` e as senhas
     num lugar seguro**: sem eles você não consegue publicar atualizações.
3. Baixe o `.zip`. Ele traz o `.aab` (para a loja) e o arquivo `assetlinks.json`.

## Passo 2 — Provar que o site é seu (Digital Asset Links)
Sem isso, o app abre com a barra de endereço do navegador no topo.

O Android procura o arquivo na **raiz do domínio**: `https://rafaelcataide.github.io/.well-known/assetlinks.json`.
Como o Grifo está numa subpasta (`/grifo/`), o arquivo precisa ficar num repositório especial:

1. Crie no GitHub um repositório público chamado exatamente **`rafaelcataide.github.io`**.
2. Dentro dele, crie o arquivo `.well-known/assetlinks.json` com o conteúdo do `assetlinks.json` que veio
   no zip do PWABuilder, e um arquivo vazio `.nojekyll` na raiz (para o GitHub publicar a pasta `.well-known`).
3. Ative o GitHub Pages nesse repositório (Settings → Pages → branch `main`).
4. Confira abrindo `https://rafaelcataide.github.io/.well-known/assetlinks.json` no navegador.

Depois de enviar o app para a Play Store, a Google assina de novo o pacote com a chave dela. Copie a
**impressão digital SHA-256** em Play Console → seu app → **Configuração → Integridade do app → Assinatura de
apps** e acrescente-a no `assetlinks.json` (no campo `sha256_cert_fingerprints`, junto com a que já está lá).

> Alternativa: um domínio próprio (ex.: `grifo.app`) apontando para o GitHub Pages resolve o mesmo problema
> e deixa o link mais bonito.

## Passo 3 — Criar o app no Play Console
1. **Criar app** → nome Grifo, idioma Português (Brasil), App, Gratuito.
2. Preencha a **Ficha da loja**:
   - Descrição curta: *Fotografe seus grifos, conecte ideias e memorize o que leu.*
   - Ícone 512×512: `icons/icon-512.png`
   - Imagem de destaque 1024×500 e pelo menos 2 capturas de tela do celular (tire no próprio app instalado).
3. **Conteúdo do app**: política de privacidade (link acima), sem anúncios, classificação de conteúdo
   (questionário), público-alvo (13+), **segurança dos dados**:
   - Coleta: nome, e-mail, foto (conta); conteúdo do usuário (livros e notas); dados de uso (erros).
   - Criptografados em trânsito: sim. O usuário pode pedir exclusão: sim (dentro do app).
4. Em **Testes → Teste interno**, envie o `.aab`, adicione seu e-mail como testador e instale pelo link.
   A Google exige teste fechado com testadores por alguns dias antes da produção para contas pessoais novas.
5. Depois do teste, promova para **Produção**.
