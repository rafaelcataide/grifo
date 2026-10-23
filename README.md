# 🖍️ Grifo — leituras que ficam

Fotografe seus grifos, conecte ideias de livros diferentes e memorize o que leu.

App web instalável (PWA) para Android, iPhone e desktop. Funciona offline e, sem configuração nenhuma, guarda tudo **no próprio aparelho** (modo pessoal). Ligando ao Supabase ([supabase/LEIA-ME.md](supabase/LEIA-ME.md)) ganha login com Google, sincronização, clubes e IA pelo servidor.

## Funcionalidades

**Livros**
- Cadastro com título, autor, páginas, situação (lendo / quero ler / lido / abandonado), datas, avaliação, ISBN e capa
- **Finalidade** (🎈 hobby, 💼 profissional, 🎓 acadêmico) e **tema › subtema** (ex.: Informática › Banco de dados), com sugestões
- **Leitor de código de barras**: aponte a câmera para o ISBN no verso do livro (ou use uma foto)
- Busca online (BrasilAPI/CBL → Google Livros → Open Library) que preenche os dados e a capa automaticamente
- **Importação** do Goodreads, do Skoob ou de qualquer planilha CSV
- **Cronômetro de leitura** que preenche os minutos ao terminar
- Registro de leitura ("parei na página X", com minutos opcionais) e previsão de término no seu ritmo
- Ao chegar na última página, o livro é concluído com nota e opinião

**Notas**
- Escrita manual: citação ou reflexão, com página e tags
- **OCR de grifos**: fotografe a página e o app detecta o marca-texto (amarelo, verde, rosa, azul, laranja), apaga o resto e lê só os trechos grifados (Tesseract.js, em português)
- Modo "Página inteira" para livros sem grifo
- **Grifos do Kindle**: importe o arquivo *My Clippings.txt*
- Busca, filtro por livro, compartilhar citação

**Ideias conectadas (estilo Obsidian)**
- Escreva `[[Nome]]` numa nota para ligá-la a um livro, a outra nota (pelo título) ou a um conceito; digitar `[[` abre sugestões
- Página de cada nota com "Liga-se a", **backlinks** ("Notas que citam esta") e ideias próximas
- Página de cada conceito, tema ou subtema reunindo livros e notas
- **Mapa mental**: grafo interativo de livros, temas, subtemas, conceitos, tags e notas, colorido pela finalidade, com busca, zoom, arrasto e toque

**Cards de memorização**
- Crie cards a partir de uma nota: **lacuna** (seleciona palavras-chave e oculta) ou **pergunta e resposta**
- Revisão com repetição espaçada (estilo Anki): Errei / Difícil / Bom / Fácil, atalhos 1–4 e espaço
- Contador de cards pendentes na aba Revisar

**IA (Claude Opus 5.5)**
- ✨ **Pergunte à sua biblioteca**: respostas tiradas só das suas notas, com as fontes citadas
- ✨ **Cards automáticos** a partir de grifos (de uma nota ou do livro inteiro)
- ✨ **Conexões sugeridas** entre ideias de livros diferentes
- No modo pessoal usa a sua chave da Anthropic; com servidor, vem pelo plano Plus

**Conta, nuvem e social** (com o servidor configurado)
- Login com **Google** ou código por e-mail; sincronização automática entre aparelhos
- **Clubes de leitura** com código de convite, ranking semanal e meta coletiva do mês
- **Perfil público** com link compartilhável (sem notas nem grifos)
- **Grifo Plus**: IA, estilos extras de arte e artes sem marca; pagamento via Stripe

**Hábito**
- Tela de **boas-vindas** em 3 passos (metas → primeiro livro → primeiro grifo)
- **Lembretes** diários (notificação no app instalado e evento no calendário do celular) e contador no ícone do app

**Análises**
- Livros e páginas lidas, páginas/dia, páginas/hora, dias por livro
- Mapa de calor dos dias de leitura, páginas por mês, livros por mês
- Finalidade, temas, subtemas, autores mais lidos, avaliações, recordes, cards e taxa de acerto
- Projeção da meta anual

**Gamificação**
- XP: 1 por página, 100 por livro concluído, 10 por nota (+5 com OCR, +5 com conexões), 5 por card, 2 por revisão, 50 por desafio semanal
- 15 níveis com títulos (Leitor Curioso → Lenda Literária)
- Sequência de dias lendo 🔥, meta diária de páginas e meta anual de livros
- Desafio semanal diferente a cada semana
- 27 medalhas (Maratona, Rede de ideias, Memória de elefante, Estudioso…) com toasts e confete

**Artes para Instagram** (geradas no próprio aparelho, em Stories 9:16 ou Feed 4:5)
- 📸 **Post de citação** a partir de qualquer nota: estilos Papel, Grifo (marca-texto desenhado), Pastel, Noite e Sua foto
- ✨ **Retrospectiva** estilo Wrapped (mês, mês passado ou ano): páginas, livros, livro do período, assunto preferido, hábito, trecho marcante, segundo cérebro e **perfil de leitor**
- 📚 **Minha estante**: prateleira de lombadas ou mosaico de capas, filtrável por ano e finalidade
- 🕸️ **Mapa mental** exportado como imagem
- 🏅 Cartões de **medalha**, **nível** e **sequência** (o aviso de conquista é clicável)
- 📖 **Lendo agora / Terminei!** com capa, progresso e sequência
- Assinatura opcional (@seuperfil) no rodapé; “Compartilhar” abre Instagram/WhatsApp no celular

**Aparência**
- Paleta suave e botão no topo para alternar entre automático, claro e escuro

## Como rodar no computador

Requer Node.js (sem dependências para instalar):

```bash
npm start
```

Abra http://localhost:5180.

## Como instalar no Android

O PWA precisa de **HTTPS** para ser instalado. O jeito mais simples é publicar a pasta de graça:

1. **GitHub Pages**: crie um repositório, envie os arquivos e ative *Settings → Pages* (branch `main`, pasta raiz). Ou **Netlify Drop**: arraste a pasta em https://app.netlify.com/drop.
2. No celular, abra o endereço no Chrome → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
3. Pronto: abre em tela cheia, com ícone próprio, e funciona offline.

Para testar rápido na rede de casa (sem instalar): rode `npm start` e abra no celular o endereço "na rede local" que aparece no terminal. Tudo funciona, menos a instalação e o modo offline.

> Para gerar um APK de verdade depois, dá para empacotar este mesmo PWA com o [PWABuilder](https://www.pwabuilder.com) (Trusted Web Activity), sem reescrever nada.

## Backup

Com conta, tudo fica salvo na nuvem automaticamente. No modo pessoal os dados ficam só no aparelho: use **⚙️ Ajustes → Exportar** para gerar um `.json` e **Importar** para restaurar ou levar para outro dispositivo.

## Estrutura

```
index.html            casca do app
css/styles.css        visual (tema claro/escuro automático)
js/app.js             telas, formulários e rotas
js/db.js              IndexedDB
js/game.js            estatísticas, XP, níveis, medalhas e desafios
js/ocr.js             detecção de marca-texto + Tesseract
js/charts.js          gráficos SVG
js/graph.js           mapa mental (grafo de forças em canvas)
js/srs.js             repetição espaçada dos cards
js/share.js           artes para Instagram (canvas)
js/scanner.js         leitor de código de barras (ISBN)
js/importers.js       Kindle, Goodreads, Skoob/CSV
js/cloud.js           login, sincronização, perfil e clubes (Supabase)
js/ai.js              IA: servidor ou chave pessoal
config.js             endereço do Supabase e link do Plus
supabase/             banco (schema.sql), funções "ai" e "stripe-webhook" e o passo a passo
sw.js                 cache offline
manifest.webmanifest  instalação como app
server.js             servidor local sem dependências
tools/gerar-icones.js gera icons/icon-192.png e icon-512.png
```
