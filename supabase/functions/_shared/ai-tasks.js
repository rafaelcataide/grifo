// Tarefas de IA do Grifo. Usado pela função "ai" do Supabase (com a chave no servidor)
// e pelo app no modo pessoal (com a chave do próprio usuário). Um único lugar para prompts e formatos.

// Modelo por tarefa, pelo custo: Haiku (o mais barato) para o que só trabalha sobre o texto enviado;
// Sonnet para o que pede síntese entre muitas notas ou conhecer livros reais.
export const HAIKU = 'claude-haiku-5-5';
export const SONNET = 'claude-sonnet-5-5';
// O Haiku não tem fallback no servidor (o parâmetro é recusado); só o Sonnet o usa.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

const TASKS = {
  // Gera cards de memorização a partir de grifos e notas
  cards: {
    model: HAIKU,
    effort: 'medium',
    system: `Você cria cards de memorização (repetição espaçada) em português do Brasil a partir de trechos e notas de livros.
Regras:
- Gere de 1 a 3 cards por nota, só sobre ideias que valem ser lembradas; ignore trechos sem conteúdo memorizável.
- Prefira "cloze" (lacuna): copie a frase essencial em "front" e envolva de 1 a 3 termos-chave com {{ }}. Em cloze, "back" é uma string vazia.
- Use "qa" quando a ideia pedir explicação: pergunta curta e objetiva em "front", resposta de até 2 frases em "back".
- Não invente fatos que não estejam no texto. Mantenha a linguagem do autor quando possível.
- Informe em "noteId" o id da nota de origem.`,
    schema: {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              noteId: { type: 'string' },
              type: { type: 'string', enum: ['cloze', 'qa'] },
              front: { type: 'string' },
              back: { type: 'string' },
            },
            required: ['noteId', 'type', 'front', 'back'],
            additionalProperties: false,
          },
        },
      },
      required: ['cards'],
      additionalProperties: false,
    },
    build: ({ notes }) => `Notas:\n${notes.slice(0, 20).map((n) => `<nota id="${n.id}" livro="${clip(n.book, 120)}"${n.page ? ` pagina="${n.page}"` : ''}>\n${clip(n.text, 2000)}\n</nota>`).join('\n')}`,
  },

  // Sugere ligações [[ ]] entre uma nota e o resto do "segundo cérebro"
  links: {
    model: HAIKU,
    effort: 'medium',
    system: `Você ajuda a conectar ideias num "segundo cérebro" de leituras (estilo Obsidian), em português do Brasil.
Recebe uma nota e a lista de pontos já existentes (livros, notas com título, temas, subtemas e conceitos).
- Em "existing", sugira até 5 pontos da lista com relação real de conteúdo com a nota (o nome deve ser copiado exatamente como na lista). Priorize ideias de outros livros.
- Em "concepts", sugira até 3 conceitos novos (1 a 3 palavras, substantivos) que a nota trata e que ainda não estão na lista.
- Em cada sugestão, "reason" explica a relação em uma frase curta.
- Se nada for relevante, devolva listas vazias.`,
    schema: {
      type: 'object',
      properties: {
        existing: { type: 'array', items: { type: 'object', properties: { target: { type: 'string' }, reason: { type: 'string' } }, required: ['target', 'reason'], additionalProperties: false } },
        concepts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'], additionalProperties: false } },
      },
      required: ['existing', 'concepts'],
      additionalProperties: false,
    },
    build: ({ note, candidates }) => `<nota livro="${clip(note.book, 120)}">\n${clip(note.text, 3000)}\n</nota>\n\n<pontos_existentes>\n${candidates.slice(0, 400).map((c) => `- ${clip(c, 100)}`).join('\n')}\n</pontos_existentes>`,
  },

  // Responde perguntas usando só as notas do usuário
  ask: {
    model: SONNET,
    effort: 'medium',
    system: `Você responde perguntas sobre a biblioteca pessoal do usuário, em português do Brasil, usando SOMENTE as notas fornecidas.
- Sintetize o que os livros dizem; compare autores quando houver visões diferentes.
- Cite as notas usadas no texto com o marcador [n<id>] logo após a afirmação (ex.: [n12]).
- Se as notas não cobrirem a pergunta, diga isso com honestidade e sugira o que o usuário poderia ler ou anotar.
- Resposta curta: até 3 parágrafos. Liste em "sources" os ids das notas citadas.`,
    schema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
      },
      required: ['answer', 'sources'],
      additionalProperties: false,
    },
    build: ({ question, notes }) => `<notas>\n${notes.slice(0, 80).map((n) => `<nota id="${n.id}" livro="${clip(n.book, 120)}" autor="${clip(n.author, 80)}"${n.page ? ` pagina="${n.page}"` : ''}>\n${clip(n.text, 900)}\n</nota>`).join('\n')}\n</notas>\n\nPergunta: ${clip(question, 500)}`,
  },

  // Corrige erros de OCR de um trecho fotografado, sem mudar o que o autor escreveu
  fixocr: {
    model: HAIKU,
    effort: 'low',
    system: `Você corrige texto extraído por OCR de páginas de livros em português do Brasil.
- Corrija só erros de leitura: letras trocadas ("nívol" → "nível"), palavras quebradas ou coladas, acentos perdidos, pontuação ruidosa e sobras soltas nas bordas (como "|", letras isoladas sem sentido).
- Não reescreva, não resuma, não modernize e não complete frases: mantenha as palavras e a ordem do autor.
- Se um trecho começar ou terminar no meio de uma frase, mantenha assim.
- Se não der para ter certeza de uma palavra, escolha a mais provável pelo contexto.`,
    schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    build: ({ text, book }) => `${book ? `Livro: ${clip(book, 150)}\n\n` : ''}<ocr>\n${clip(text, 6000)}\n</ocr>`,
  },

  // Sugere próximas leituras a partir do que a pessoa leu, avaliou e grifou
  recommend: {
    model: SONNET,
    effort: 'medium',
    system: `Você recomenda livros, em português do Brasil, com base no histórico de leitura de uma pessoa.
- Sugira 5 livros reais e conhecidos que NÃO estejam na lista de livros que ela já tem.
- Prefira livros com edição em português quando existirem; use o título em português nesse caso.
- Em "why", explique em 1 ou 2 frases a ligação com o que ela leu ou grifou (cite o livro ou a ideia), sem elogios vagos.
- Equilibre: ao menos uma sugestão que aprofunde o tema mais lido e uma que traga um tema vizinho, novo para ela.
- Em "purpose", classifique como "hobby", "professional" ou "academic".`,
    schema: {
      type: 'object',
      properties: {
        books: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              author: { type: 'string' },
              theme: { type: 'string' },
              purpose: { type: 'string', enum: ['hobby', 'professional', 'academic'] },
              why: { type: 'string' },
            },
            required: ['title', 'author', 'theme', 'purpose', 'why'],
            additionalProperties: false,
          },
        },
      },
      required: ['books'],
      additionalProperties: false,
    },
    build: ({ read, highlights, owned, focus }) => `<lidos>\n${read.slice(0, 60).map((b) => `- ${clip(b.title, 120)} — ${clip(b.author, 80)}${b.theme ? ` [${clip(b.theme, 60)}]` : ''}${b.rating ? ` nota ${b.rating}/5` : ''}`).join('\n')}\n</lidos>\n\n<grifos_marcantes>\n${highlights.slice(0, 15).map((h) => `- "${clip(h, 300)}"`).join('\n')}\n</grifos_marcantes>\n\n<ja_tem>\n${owned.slice(0, 300).map((t) => `- ${clip(t, 120)}`).join('\n')}\n</ja_tem>${focus ? `\n\nFoco pedido: ${clip(focus, 200)}` : ''}`,
  },
};

// Fichamento: resumo do livro feito só a partir dos grifos e notas da pessoa
TASKS.summary = {
  model: SONNET,
  effort: 'medium',
  system: `Você monta fichamentos de livros em português do Brasil, usando SOMENTE os grifos e as notas que a pessoa fez.
- "overview": 2 parágrafos curtos sobre o que o livro trouxe para essa pessoa, a partir do que ela grifou (não resuma o livro inteiro de memória).
- "ideas": de 3 a 7 ideias principais; em cada uma, um título curto, uma explicação de 1 a 3 frases e os ids das notas que a sustentam.
- "quotes": os ids de 2 a 4 grifos mais marcantes (só citações literais).
- "questions": 2 ou 3 perguntas para a pessoa refletir ou revisar.
- Não invente o que não está nas notas. Escreva de forma clara e direta, sem elogios.`,
  schema: {
    type: 'object',
    properties: {
      overview: { type: 'string' },
      ideas: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, notes: { type: 'array', items: { type: 'string' } } }, required: ['title', 'text', 'notes'], additionalProperties: false } },
      quotes: { type: 'array', items: { type: 'string' } },
      questions: { type: 'array', items: { type: 'string' } },
    },
    required: ['overview', 'ideas', 'quotes', 'questions'],
    additionalProperties: false,
  },
  build: ({ book = {}, notes = [] }) => `<livro titulo="${clip(book.title, 150)}" autor="${clip(book.author, 100)}"/>\n<notas>\n${notes.slice(0, 120).map((n) => `<nota id="${n.id}" tipo="${n.kind === 'quote' ? 'citação' : 'reflexão'}"${n.page ? ` pagina="${n.page}"` : ''}>\n${clip(n.text, 900)}\n</nota>`).join('\n')}\n</notas>`,
};

// Técnica de Feynman: a pessoa explica uma ideia com as próprias palavras e recebe um retorno
TASKS.feynman = {
  model: HAIKU,
  effort: 'medium',
  system: `Você é um tutor gentil e direto, em português do Brasil. A pessoa explicou uma ideia com as próprias palavras (técnica de Feynman).
Compare a explicação com as notas dela sobre o assunto (a referência) e dê um retorno curto e útil:
- "score": nota de 0 a 10 para clareza e fidelidade às notas.
- "verdict": uma frase com a avaliação geral.
- "right": até 3 pontos que ela explicou bem.
- "missing": até 3 pontos importantes das notas que ficaram de fora.
- "wrong": até 3 confusões ou erros (lista vazia se não houver).
- "tip": uma dica prática para explicar melhor (ex.: um exemplo do dia a dia).
Se as notas não bastarem para avaliar algum ponto, diga isso em vez de inventar.`,
  schema: {
    type: 'object',
    properties: {
      score: { type: 'integer' },
      verdict: { type: 'string' },
      right: { type: 'array', items: { type: 'string' } },
      missing: { type: 'array', items: { type: 'string' } },
      wrong: { type: 'array', items: { type: 'string' } },
      tip: { type: 'string' },
    },
    required: ['score', 'verdict', 'right', 'missing', 'wrong', 'tip'],
    additionalProperties: false,
  },
  build: ({ topic, explanation, notes = [] }) => `Ideia: ${clip(topic, 150)}\n\n<notas_de_referencia>\n${notes.slice(0, 30).map((n) => `<nota livro="${clip(n.book, 120)}">\n${clip(n.text, 800)}\n</nota>`).join('\n')}\n</notas_de_referencia>\n\n<explicacao_da_pessoa>\n${clip(explanation, 3000)}\n</explicacao_da_pessoa>`,
};

// Classificação de artigo: finalidade, tema e subtema, de preferência usando os que a pessoa já tem
TASKS.classify = {
  model: HAIKU,
  effort: 'low',
  system: `Você classifica artigos salvos numa biblioteca pessoal de leituras, em português do Brasil.
- "purpose": "hobby" (lazer, cultura, curiosidade), "professional" (trabalho, carreira, negócios, tecnologia aplicada) ou "academic" (estudo, ciência, provas, pesquisa).
- "theme": a área ampla (1 a 3 palavras). Se algum tema da lista de temas existentes servir, copie o nome exatamente igual.
- "subtheme": o assunto mais específico (1 a 4 palavras). Prefira um subtema existente daquele tema quando servir.
- Use português, com inicial maiúscula.`,
  schema: {
    type: 'object',
    properties: {
      purpose: { type: 'string', enum: ['hobby', 'professional', 'academic'] },
      theme: { type: 'string' },
      subtheme: { type: 'string' },
    },
    required: ['purpose', 'theme', 'subtheme'],
    additionalProperties: false,
  },
  build: ({ title, site, text, themes = [] }) => `<temas_existentes>\n${themes.slice(0, 80).map((t) => `- ${clip(t.theme, 60)}${t.subthemes?.length ? `: ${t.subthemes.slice(0, 12).map((x) => clip(x, 40)).join(', ')}` : ''}`).join('\n')}\n</temas_existentes>\n\n<artigo titulo="${clip(title, 200)}" site="${clip(site, 80)}">\n${clip(text, 5000)}\n</artigo>`,
};

export const TASK_NAMES = Object.keys(TASKS);

// Parâmetros para client.beta.messages.create (SDK oficial da Anthropic)
export function buildParams(task, input) {
  const t = TASKS[task];
  if (!t) throw new Error(`tarefa desconhecida: ${task}`);
  return {
    model: t.model,
    max_tokens: 16000,
    ...(t.model === SONNET ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    output_config: { effort: t.effort, format: { type: 'json_schema', schema: t.schema } },
    system: input?.lang === 'en' ? `${t.system}

The user's app is in English: write every text field of your answer in English (keep book quotes in their original language).` : t.system,
    messages: [{ role: 'user', content: t.build(input) }],
  };
}

export function parseResult(message) {
  if (message.stop_reason === 'refusal') {
    const err = new Error('A IA não pôde responder a esse conteúdo.');
    err.code = 'refusal';
    throw err;
  }
  if (message.stop_reason === 'max_tokens') throw new Error('A resposta ficou longa demais. Tente com menos notas.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}
