// Tarefas de IA do Grifo. Usado pela função "ai" do Supabase (com a chave no servidor)
// e pelo app no modo pessoal (com a chave do próprio usuário). Um único lugar para prompts e formatos.

export const MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

const TASKS = {
  // Gera cards de memorização a partir de grifos e notas
  cards: {
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
};

export const TASK_NAMES = Object.keys(TASKS);

// Parâmetros para client.beta.messages.create (SDK oficial da Anthropic)
export function buildParams(task, input) {
  const t = TASKS[task];
  if (!t) throw new Error(`tarefa desconhecida: ${task}`);
  return {
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: t.effort, format: { type: 'json_schema', schema: t.schema } },
    system: t.system,
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
