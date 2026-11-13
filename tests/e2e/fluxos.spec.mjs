// Fluxos principais do Grifo, do jeito que a pessoa usa (mouse, toque, teclado).
// Cada teste começa com o navegador limpo, em modo pessoal e com poucos dados de exemplo.
import { test, expect } from '@playwright/test';
import { modoPessoal, semear, livro, artigo, nota, card, lerBanco, pdfDeTeste } from './ajuda.mjs';

// bloqueios da política de segurança (CSP) em qualquer teste: um serviço usado pelo app ficou fora da lista
const bloqueios = new WeakMap();
test.beforeEach(async ({ page }) => {
  await modoPessoal(page);
  page.on('pageerror', (e) => { throw new Error(`Erro na página: ${e.message}`); });
  const lista = [];
  bloqueios.set(page, lista);
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) lista.push(m.text().slice(0, 300)); });
});
test.afterEach(async ({ page }) => {
  expect(bloqueios.get(page) || [], 'a CSP do index.html bloqueou algo que o app usa').toEqual([]);
});

// seleciona um trecho de um parágrafo arrastando o mouse (como no computador)
async function arrastarSobre(page, locator, de = 0.02, ate = 0.55) {
  const box = await locator.boundingBox();
  const y = box.y + 12;
  await page.mouse.move(box.x + box.width * de, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ate, y, { steps: 8 });
  await page.mouse.up();
}

test('artigo: selecionar com o mouse e Grifar salva a nota, completando palavras cortadas @celular', async ({ page }) => {
  await semear(page, { books: [artigo('a1')] });
  await page.goto('/#/artigo/a1');
  const p = page.locator('#reader-body p').nth(1);
  await arrastarSobre(page, p);
  await page.getByRole('button', { name: 'Grifar trecho' }).click();
  await expect(page.locator('#reader-body mark')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Seus grifos (1)' })).toBeVisible();
  const [n] = await lerBanco(page, 'notes');
  expect(n.bookId).toBe('a1');
  expect(n.text.startsWith('Revisar em intervalos')).toBe(true);
  expect(/\p{L}$/u.test(n.text.split(' ').pop()) && !/\s\S$/.test(n.text)).toBe(true); // termina numa palavra inteira
});

test('artigo: Grifar no celular (toque no botão) @so-celular', async ({ page }) => {
  await semear(page, { books: [artigo('a1')] });
  await page.goto('/#/artigo/a1');
  // no toque, a seleção é feita pelo sistema; aqui ela é criada direto e o botão é tocado
  await page.evaluate(() => {
    const t = document.querySelectorAll('#reader-body p')[0].firstChild;
    const r = document.createRange();
    r.setStart(t, 0); r.setEnd(t, 20);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await page.getByRole('button', { name: 'Grifar trecho' }).tap();
  await expect(page.locator('#reader-body mark')).toHaveCount(1);
});

test('nota: várias tags com ponto e vírgula e vírgula, sem repetir', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'O [[Sistema 1]] é rápido.', { tags: ['mente'] })] });
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Mais opções…' }).click();
  await page.getByLabel('Tags').fill('mente; vieses;decisão, Mente');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes'))[0].tags).toEqual(['mente', 'vieses', 'decisão']);
});

test('tags antigas gravadas juntas são separadas ao abrir o app', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'texto', { tags: ['religião;umbanda', '#religião'] })] });
  await page.goto('/#/notas');
  await expect(page.locator('#note-list .chip.tag')).toHaveText(['#religião', '#umbanda']);
});

test('mapa: esconder tags não esconde a ideia de mesmo nome', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Sobre [[Umbanda]].', { tags: ['umbanda'] })] });
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'rede')); // estes testes são da rede de pontos
  await page.goto('/#/mapa');
  await page.locator('[data-map-show=tags]').uncheck();
  await page.locator('#graph-search').fill('Umbanda');
  await page.locator('#graph-search').press('Enter');
  await expect(page.locator('#graph-panel .chip').first()).toHaveText('Ideia');
});

test('mapa: filtro por tema digitando no campo', async ({ page }) => {
  await semear(page, { books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', author: 'James Clear', genre: 'Produtividade' })] });
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'rede')); // estes testes são da rede de pontos
  await page.goto('/#/mapa');
  await expect(page.locator('#graph-legend a')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Todos os temas' }).fill('produt');
  await page.keyboard.press('Enter');
  await expect(page.locator('#graph-legend a')).toHaveText(['Produtividade']);
});

test('revisão: revelar e responder tira o card de hoje', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'x')], cards: [card('c1', 'b1', 'n1')] });
  await page.goto('/#/revisar');
  await page.getByRole('button', { name: /Revisar 1 cards? agora/ }).click();
  await page.getByRole('button', { name: /Mostrar resposta/ }).click();
  await page.getByRole('button', { name: /^Bom/ }).click();
  await expect(page.getByText('Revisão concluída!')).toBeVisible();
  const [c] = await lerBanco(page, 'cards');
  expect(c.reps).toBe(1);
  expect(c.due > new Date().toISOString().slice(0, 10)).toBe(true);
});

test('novo livro: a busca junta Google Livros e Open Library, mostra a edição em português primeiro e preenche o formulário @celular', async ({ page }) => {
  // as bases de livros são simuladas: o teste não depende da internet nem gasta a cota delas
  const pedidos = [];
  await page.route('https://www.googleapis.com/books/**', (route) => {
    pedidos.push(route.request().url());
    return route.fulfill({ json: { items: [
      { volumeInfo: { title: 'Thinking, Fast and Slow', authors: ['Daniel Kahneman'], pageCount: 499, language: 'en', publishedDate: '2011', publisher: 'FSG', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780374275631' }] } },
      { volumeInfo: { title: 'Rápido e devagar', subtitle: 'Duas formas de pensar', authors: ['Daniel Kahneman'], language: 'pt', publishedDate: '2012', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9788539003830' }] } },
    ] } });
  });
  await page.route('https://openlibrary.org/search.json**', (route) => {
    pedidos.push(route.request().url());
    return route.fulfill({ json: { docs: [{ title: 'Rápido e Devagar', author_name: ['Daniel Kahneman'], number_of_pages_median: 608, isbn: ['9788539003830'], publisher: ['Objetiva'], first_publish_year: 2012, language: ['por'] }] } });
  });
  await semear(page);
  await page.goto('/#/livros');
  await page.locator('[data-action="newBook"]').first().click();
  await page.locator('#book-form [name="lookup"]').fill('rapido e devagar');
  await page.locator('#lookup-btn').click();
  const itens = page.locator('.lookup-item');
  await expect(itens).toHaveCount(1); // a edição brasileira veio das duas bases e virou uma só; a em inglês não bate com o título digitado
  await expect(itens.first()).toContainText('Rápido e devagar: Duas formas de pensar');
  await expect(itens.first()).toContainText('Objetiva, 2012 · 608 pág.'); // editora e páginas vieram da Open Library
  expect(pedidos.length).toBe(2); // as duas bases, uma vez cada
  await itens.first().click();
  await expect(page.locator('#book-form [name="title"]')).toHaveValue('Rápido e devagar: Duas formas de pensar');
  await expect(page.locator('#book-form [name="pages"]')).toHaveValue('608');
  await expect(page.locator('#book-form [name="isbn"]')).toHaveValue('9788539003830');
});

test('artigo: "Resumo" pede o resumo à IA uma vez, guarda no artigo e mostra no topo @celular', async ({ page }) => {
  await semear(page, { books: [artigo('a1', { blocks: [{ t: 'p', x: 'Ler devagar dá tempo para cada ideia se ligar ao que você já sabe, e isso muda tudo na memória. '.repeat(6) }] }), artigo('a2', { title: 'Curto', blocks: [{ t: 'p', x: 'Texto curto.' }] })] });
  await page.goto('/#/artigo/a1');
  const pedidos = await page.evaluateHandle(() => {
    const log = [];
    globalThis.__aiMock = async (task, input) => {
      log.push({ task, title: input.title, chars: input.text.length });
      return { gist: `Ler devagar fixa melhor (${log.length}).`, points: ['Cada ideia precisa de tempo.', 'Revisar em intervalos ajuda.', ''], audience: 'Para quem estuda.' };
    };
    return log;
  });
  await expect(page.locator('#art-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resumo', exact: true }).click();
  const card = page.locator('#art-summary');
  await expect(card).toContainText('Ler devagar fixa melhor (1).');
  await expect(card.locator('li')).toHaveText(['Cada ideia precisa de tempo.', 'Revisar em intervalos ajuda.']); // ponto vazio fica de fora
  await expect(card).toContainText('Para quem estuda.');
  await expect(card).toContainText('Gerado por IA');
  await expect(page.getByRole('button', { name: 'Resumo', exact: true })).toHaveCount(0); // já tem: o botão dá lugar ao "Refazer"
  // fica guardado: reabrir não chama a IA de novo
  await page.goto('/#/artigos');
  await page.goto('/#/artigo/a1');
  await expect(page.locator('#art-summary')).toContainText('Ler devagar fixa melhor (1).');
  expect((await pedidos.jsonValue()).map((p) => [p.task, p.title])).toEqual([['artsummary', 'Por que ler devagar ajuda a lembrar']]);
  const salvo = (await lerBanco(page, 'books')).find((b) => b.id === 'a1');
  expect(salvo.summary.points).toHaveLength(2);
  // "Refazer" troca o resumo
  await page.getByRole('button', { name: 'Refazer' }).click();
  await expect(page.locator('#art-summary')).toContainText('Ler devagar fixa melhor (2).');
  // artigo sem texto suficiente não oferece resumo
  await page.goto('/#/artigo/a2');
  await expect(page.getByRole('heading', { name: 'Curto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resumo', exact: true })).toHaveCount(0);
});

test('novo livro: "Preencher pela foto" lê a ficha com IA e guarda editora, cidade e ano para a referência @celular', async ({ page }) => {
  await semear(page, { settings: { aiKey: 'chave-de-teste' } }); // modo pessoal com IA ligada (as chamadas são simuladas)
  await page.goto('/#/livros');
  const pedidos = await page.evaluateHandle(() => {
    const log = [];
    globalThis.__aiMock = async (task, input) => {
      log.push({ task, image: input.image.length });
      return log.length === 1
        ? { found: true, title: 'Rápido e devagar', subtitle: 'Duas formas de pensar', author: 'Daniel Kahneman', publisher: 'Objetiva', city: 'Rio de Janeiro', year: '2012', edition: '1', isbn: '978-85-390-0383-9', pages: 608 }
        : { found: false, title: '', subtitle: '', author: '', publisher: '', city: '', year: '', edition: '', isbn: '', pages: 0 };
    };
    return log;
  });
  await page.locator('[data-action="newBook"]').first().click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await expect(page.getByRole('button', { name: 'Preencher pela foto' })).toBeVisible();
  await page.locator('#ficha-file').setInputFiles({ name: 'ficha.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#ficha-status')).toContainText('Preenchido pela foto.');
  await expect(page.locator('#ficha-status')).toContainText('Objetiva, Rio de Janeiro, 2012, 1ª ed.');
  const form = page.locator('#book-form');
  await expect(form.locator('[name="title"]')).toHaveValue('Rápido e devagar: Duas formas de pensar');
  await expect(form.locator('[name="author"]')).toHaveValue('Daniel Kahneman');
  await expect(form.locator('[name="pages"]')).toHaveValue('608');
  await expect(form.locator('[name="isbn"]')).toHaveValue('9788539003839');
  // foto que não é de livro: avisa e não apaga o que já estava preenchido
  await page.locator('#ficha-file').setInputFiles({ name: 'outra.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#ficha-status')).toContainText('Não consegui ler os dados do livro');
  await expect(form.locator('[name="title"]')).toHaveValue('Rápido e devagar: Duas formas de pensar');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form).toBeHidden();
  const [livroSalvo] = await lerBanco(page, 'books');
  expect(livroSalvo).toMatchObject({ title: 'Rápido e devagar: Duas formas de pensar', publisher: 'Objetiva', city: 'Rio de Janeiro', year: '2012', edition: '1', isbn: '9788539003839' });
  expect((await pedidos.jsonValue()).map((p) => p.task)).toEqual(['bookphoto', 'bookphoto']);
});

test('busca única: encontra livro, nota e texto de artigo', async ({ page }) => {
  await semear(page, { books: [livro('b1'), artigo('a1')], notes: [nota('n1', 'b1', 'A memória gosta de pausas.')] });
  await page.goto('/#/');
  await page.keyboard.press('/');
  await expect(page).toHaveURL(/#\/busca/);
  await page.locator('#search-all').fill('memória');
  await expect(page.getByRole('heading', { name: /Artigos \(1\)/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Notas \(1\)/ })).toBeVisible();
  await page.locator('#search-all').fill('kahneman');
  await expect(page.getByRole('heading', { name: /Livros \(1\)/ })).toBeVisible();
});

test('primeiros passos: mostra o próximo passo e some ao esconder', async ({ page }) => {
  await semear(page, { books: [livro('b1')], settings: { firstStepsHidden: false } });
  await page.goto('/#/');
  const box = page.locator('.first-steps');
  await expect(box).toContainText('1 de 6');
  await expect(box.locator('li.next')).toContainText('Guarde um grifo');
  await box.getByRole('button', { name: 'Esconder' }).click();
  await expect(box).toHaveCount(0);
});

test('artigos: fila (ler depois, lendo, lidos) e tempo de leitura', async ({ page }) => {
  await semear(page, { books: [artigo('a1'), artigo('a2', { title: 'Outro', status: 'finished' })] });
  await page.goto('/#/artigos');
  await expect(page.locator('.art-item')).toHaveCount(2);
  await expect(page.locator('.art-item').first()).toContainText('min');
  await page.getByRole('button', { name: /Lidos \(1\)/ }).click();
  await expect(page.locator('.art-item')).toHaveCount(1);
  await expect(page.locator('.art-item')).toContainText('Outro');
});

test('exportar: Anki e Obsidian/Notion baixam arquivos', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'O [[Sistema 1]] é rápido.')], cards: [card('c1', 'b1', 'n1')] });
  await page.goto('/#/ajustes');
  const [anki] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Anki/ }).click()]);
  expect(anki.suggestedFilename()).toMatch(/^grifo-anki-.*\.txt$/);
  const [zip] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: /Obsidian/ }).click()]);
  expect(zip.suggestedFilename()).toMatch(/^grifo-.*\.zip$/);
});

test('PDF: abrir, ver as páginas e importar o grifo feito em outro app', async ({ page }) => {
  await semear(page);
  await page.goto('/#/artigos');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Adicionar PDF' }).click();
  await (await chooser).setFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: pdfDeTeste() });
  await expect(page).toHaveURL(/#\/pdf\//, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Guia de Leitura Lenta' })).toBeVisible();
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Seus grifos (1)' })).toBeVisible({ timeout: 30_000 });
  const [n] = await lerBanco(page, 'notes');
  expect(n.page).toBe(1);
  expect(n.text).toContain('Cada ideia precisa de tempo');
  expect(n.text).toContain('Vale para os cards');
});

test('PDF: selecionar um trecho da página e Grifar salva a nota com a página @celular', async ({ page }) => {
  await semear(page);
  await page.goto('/#/artigos');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Adicionar PDF' }).click();
  await (await chooser).setFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: pdfDeTeste() });
  await expect(page).toHaveURL(/#\/pdf\//, { timeout: 30_000 });
  const trecho = page.locator('.pdf-page[data-page="1"] .textLayer span', { hasText: 'Ler devagar' }).first();
  await expect(trecho).toBeVisible({ timeout: 30_000 });
  // o texto selecionável fica por cima do desenho da página (depende do estilo do leitor de PDF ter carregado)
  const pos = await page.evaluate(() => {
    const pg = document.querySelector('.pdf-page[data-page="1"]');
    const layer = pg.querySelector('.textLayer').getBoundingClientRect(), canvas = pg.querySelector('canvas').getBoundingClientRect();
    return { estilo: getComputedStyle(pg.querySelector('.textLayer')).position, sobre: Math.abs(layer.top - canvas.top) < 4 && Math.abs(layer.height - canvas.height) < 4 };
  });
  expect(pos).toEqual({ estilo: 'absolute', sobre: true });
  // seleciona o trecho (a seleção pelo toque ou pelo mouse termina num intervalo como este) e grifa
  await trecho.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.getByRole('button', { name: 'Grifar trecho' }).click();
  await expect(page.getByRole('heading', { name: 'Seus grifos (2)' })).toBeVisible();
  const nova = (await lerBanco(page, 'notes')).find((x) => x.text.startsWith('Ler devagar'));
  expect(nova).toMatchObject({ source: 'pdf', page: 1, kind: 'quote' });
  // o grifo fica pintado na página, por cima do trecho
  expect(nova.rects.length).toBeGreaterThan(0);
  const pintado = page.locator(`.pdf-hl[data-note="${nova.id}"]`).first();
  await expect(pintado).toBeAttached();
  const sobre = async () => page.evaluate((id) => {
    const hl = document.querySelector(`.pdf-hl[data-note="${id}"]`).getBoundingClientRect();
    const sp = [...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')].find((s) => s.textContent.includes('Ler devagar')).getBoundingClientRect();
    return Math.abs(hl.top - sp.top) < 6 && Math.abs(hl.left - sp.left) < 6 && hl.width > 20;
  }, nova.id);
  expect(await sobre()).toBe(true);
  // o grifo que já vinha no arquivo (importado, sem posição guardada) é achado pelo texto e pintado também
  const importada = (await lerBanco(page, 'notes')).find((x) => x.id !== nova.id);
  await expect(page.locator(`.pdf-hl[data-note="${importada.id}"]`).first()).toBeAttached();
  // reabrir o PDF: os grifos continuam na página
  await page.reload();
  await expect(page.locator(`.pdf-hl[data-note="${nova.id}"]`).first()).toBeAttached({ timeout: 30_000 });
  expect(await sobre()).toBe(true);
  // "Apagar só o arquivo": o PDF sai, o título e os grifos ficam
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Apagar só o arquivo' }).click();
  await expect(page.locator('#pdf-status')).toContainText('foi apagado');
  await expect(page.locator('.pdf-page')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Seus grifos (2)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apagar só o arquivo' })).toHaveCount(0);
  const [reg] = await lerBanco(page, 'books');
  expect(reg).toMatchObject({ kind: 'pdf', fileGone: true });
  expect(await page.evaluate(async (id) => (await (await import('/js/db.js')).db.getFile(id)) == null, reg.id)).toBe(true);
  await page.goto('/#/artigos');
  await expect(page.locator('#view')).toContainText('sem o arquivo');
  // dá para colocar o arquivo de novo: os grifos voltam a aparecer na página
  await page.goto(`/#/pdf/${reg.id}`);
  const de_novo = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Colocar o arquivo de novo' }).click();
  await (await de_novo).setFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: pdfDeTeste() });
  await expect(page.locator(`.pdf-hl[data-note="${nova.id}"]`).first()).toBeAttached({ timeout: 30_000 });
});

test('post da citação: escolher tema e cor desenha a arte', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Ler devagar é a forma mais rápida de lembrar.')] });
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.locator('label[for=sg-style-ereader]').click();
  await page.locator('label[for=sg-tone-rosa]').click();
  await expect(page.locator('#studio-preview img')).toBeVisible();
});

test('apresentação: quem não entrou vê a página do Grifo e o convite fica guardado', async ({ page }) => {
  await page.unroute('**/config.js'); // com o servidor configurado, como no site
  await page.goto('/?convite=abc1234#/');
  await expect(page.getByRole('heading', { name: 'Suas leituras, grifadas para sempre.' })).toBeVisible();
  await expect(page.getByText('Você foi convidado')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('grifo.invite'))).toBe('abc1234');
  await page.getByRole('link', { name: 'Começar grátis' }).first().click();
  await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
});

test('em inglês: telas principais sem texto faltando na tradução', async ({ page }) => {
  await semear(page, { books: [livro('b1'), artigo('a1')], notes: [nota('n1', 'b1', 'x', { tags: ['mente'] })], cards: [card('c1', 'b1', 'n1')], settings: { firstStepsHidden: false } });
  await page.evaluate(() => localStorage.setItem('grifo.lang', 'en'));
  for (const r of ['#/', '#/livros', '#/artigos', '#/artigo/a1', '#/notas', '#/mapa', '#/revisar', '#/busca', '#/tags', '#/vocabulario', '#/ajustes', '#/plus', '#/privacidade']) {
    await page.goto(`/${r}`);
    await page.waitForTimeout(300);
  }
  // textos do próprio usuário (títulos, notas) não entram na conta
  const faltando = await page.evaluate(() => [...(globalThis.__i18nMissing || [])].filter((s) => !/Rápido e Devagar|Kahneman|Vieses|Psicologia|Por que ler devagar|Revista|Ler devagar|Revisar em intervalos|O que é o Sistema 1|Rápido e intuitivo|^RE$|^x$|^#?mente$/.test(s)));
  expect(faltando).toEqual([]);
});

test('tags: renomear, juntar com outra e remover', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [
    nota('n1', 'b1', 'um', { tags: ['psico', 'mente'] }),
    nota('n2', 'b1', 'dois', { tags: ['Psicologia'] }),
    nota('n3', 'b1', 'três', { tags: ['rascunho'] }),
  ] });
  await page.goto('/#/notas');
  await page.getByRole('link', { name: 'Tags' }).click();
  await expect(page).toHaveURL(/#\/tags/);
  await expect(page.locator('#tag-list .tag-row')).toHaveCount(4);
  // juntar: renomear "psico" para o nome de uma tag que já existe
  await page.getByRole('button', { name: 'Renomear ou juntar #psico', exact: true }).click();
  await page.getByLabel('Novo nome').fill('psicologia');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('#tag-list .tag-row')).toHaveCount(3);
  await expect(page.locator('#tag-list .tag-row').first()).toContainText('2 notas');
  // remover
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remover #rascunho' }).click();
  await expect(page.locator('#tag-list .tag-row')).toHaveCount(2);
  const notes = Object.fromEntries((await lerBanco(page, 'notes')).map((n) => [n.id, n.tags]));
  expect(notes).toEqual({ n1: ['psicologia', 'mente'], n2: ['Psicologia'], n3: [] });
});

test('OCR: a foto é lida na hora; depois dá para marcar só a área que vai ser lida @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Nova' }).click();
  // uma imagem pequena qualquer (PNG 1x1 ampliado pelo navegador)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('#ocr-file').setInputFiles({ name: 'pagina.png', mimeType: 'image/png', buffer: png });
  const crop = page.locator('#ocr-crop');
  // sem passo no meio: lê direto e só então oferece "Ajustar área" (a foto de teste não tem texto)
  await expect(page.locator('#ocr-status')).toContainText('Nenhum grifo encontrado', { timeout: 60_000 });
  await expect(crop).toBeHidden();
  await page.getByRole('button', { name: 'Ajustar área' }).click();
  await expect(crop).toBeVisible();
  await expect(page.locator('#crop-go')).toHaveText(/Ler a foto toda/);
  await page.locator('#crop-img').evaluate((img) => { img.style.width = '300px'; img.style.height = '200px'; });
  const box = await page.locator('#crop-img').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#crop-rect')).toBeVisible();
  await expect(page.locator('#crop-go')).toHaveText(/Ler esta área/);
  await page.locator('#crop-cancel').click();
  await expect(crop).toBeHidden();
});

test('OCR: foto difícil é lida pela IA sozinha (opção ligada por padrão); desligando, fica só no aparelho @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')], settings: { aiKey: 'chave-de-teste' } }); // modo pessoal com IA ligada (as chamadas são simuladas)
  await page.goto('/#/notas');
  const pedidos = await page.evaluateHandle(() => {
    const log = [];
    globalThis.__aiMock = async (task, input) => {
      log.push({ task, mode: input.mode, image: input.image.length });
      return { found: true, text: log.length === 1 ? 'Ler devagar é a forma mais rápida de lembrar.' : 'Segunda leitura.' };
    };
    return log;
  });
  await page.getByRole('button', { name: 'Nova' }).click();
  await expect(page.locator('#ocr-ai')).toBeChecked(); // vem ligada, com o aviso de que a foto é enviada
  await expect(page.locator('#ocr-ai-hint')).toContainText('enviada à Anthropic');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('#ocr-file').setInputFiles({ name: 'pagina.png', mimeType: 'image/png', buffer: png });
  // o OCR do aparelho não leu nada: a IA lê sozinha, sem a pessoa marcar nada
  await expect(page.locator('#ocr-status')).toContainText('Lido com IA', { timeout: 60_000 });
  await expect(page.locator('textarea[name="text"]')).toHaveValue('Ler devagar é a forma mais rápida de lembrar.');
  // pedir de novo troca o texto dessa foto (não empilha)
  await page.getByRole('button', { name: 'Ler com IA' }).click();
  await expect(page.locator('textarea[name="text"]')).toHaveValue('Segunda leitura.');
  const log = await pedidos.jsonValue();
  expect(log.map((p) => p.task)).toEqual(['readphoto', 'readphoto']);
  expect(log[0].mode).toBe('highlight');
  expect(log[0].image).toBeGreaterThan(100);
  // desligando a opção, a foto difícil fica só com o aviso
  await page.locator('#ocr-ai').uncheck();
  await page.locator('#ocr-file').setInputFiles({ name: 'pagina.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#ocr-status')).toContainText('Nenhum grifo encontrado', { timeout: 60_000 });
  expect((await pedidos.jsonValue()).length).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('grifo.ocrAI'))).toBe('0'); // a escolha fica guardada
});

test('OCR: quem desligou a leitura por IA continua sem mandar a foto @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')], settings: { aiKey: 'chave-de-teste' } });
  await page.addInitScript(() => localStorage.setItem('grifo.ocrAI', '0'));
  await page.goto('/#/notas');
  await page.evaluate(() => { globalThis.__pedidosIA = 0; globalThis.__aiMock = async () => { globalThis.__pedidosIA++; return { found: true, text: 'x' }; }; });
  await page.getByRole('button', { name: 'Nova' }).click();
  await expect(page.locator('#ocr-ai')).not.toBeChecked();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('#ocr-file').setInputFiles({ name: 'pagina.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#ocr-status')).toContainText('Nenhum grifo encontrado', { timeout: 60_000 });
  expect(await page.evaluate(() => globalThis.__pedidosIA)).toBe(0);
});

test('nota solta: criar sem livro e achar pelo filtro "Sem livro"', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Nota do livro.')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Nova' }).click();
  const campo = page.getByRole('combobox', { name: 'Digite para buscar…' });
  await campo.fill('sem livro');
  await page.keyboard.press('Enter');
  await page.getByLabel('Texto').fill('Uma ideia que não veio de livro nenhum.');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes')).find((n) => n.id !== 'n1')?.bookId).toBeNull();
  await page.goto('/#/notas');
  await expect(page.locator('#note-list .note')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Todos os livros e artigos' }).fill('sem liv');
  await page.keyboard.press('Enter');
  await expect(page.locator('#note-list .note')).toHaveCount(1);
  await expect(page.locator('#note-list .note')).toContainText('não veio de livro');
});

test('nota: abrir a edição não abre a lista de livros sozinha; tocar no campo abre @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Ler devagar ajuda a lembrar.')] });
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: 'Mais' }).click();
  await page.getByRole('button', { name: /Título, tags, livro e página/ }).click();
  const lista = page.locator('#note-form .combo-list');
  await expect(page.locator('#note-form')).toBeVisible();
  await expect(lista).toBeHidden();
  expect(await page.evaluate(() => document.activeElement.id)).toBe('modal'); // nenhum campo com foco: o teclado não sobe
  await page.locator('#note-form .combo input.search').click();
  await expect(lista).toBeVisible();
});

test('nota: escolher o livro digitando parte do título', async ({ page }) => {
  await semear(page, { books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', author: 'James Clear' })] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Nova' }).click();
  const campo = page.getByRole('combobox', { name: 'Digite para buscar…' });
  await campo.fill('atom');
  await expect(page.locator('#note-form .combo-list li[data-v]:not([data-v=""])')).toHaveText(['Hábitos Atômicos']);
  await page.keyboard.press('Enter');
  await expect(campo).toHaveValue('Hábitos Atômicos');
  await page.getByLabel('Texto').fill('Pequenos hábitos somam.');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes'))[0]?.bookId).toBe('b2');
});

test('início: artigos em leitura aparecem em "Lendo agora" e os da fila num atalho', async ({ page }) => {
  await semear(page, { books: [livro('b1'), artigo('a1', { status: 'reading' }), artigo('a2', { title: 'Para depois' })] });
  await page.goto('/#/');
  await expect(page.locator('.art-item')).toHaveCount(1);
  await expect(page.locator('.art-item')).toContainText('Por que ler devagar');
  await page.getByRole('link', { name: /1 artigo para ler depois/ }).click();
  await expect(page).toHaveURL(/#\/artigos/);
});

// dicionário simulado: o teste não depende da internet
async function dicionarioFalso(page) {
  await page.route('https://pt.wiktionary.org/**', (route) => {
    const word = new URL(route.request().url()).searchParams.get('page');
    const text = `<div class="mw-parser-output"><div class="mw-heading mw-heading1"><h1 id="Português">Português</h1></div>
      <div class="mw-heading mw-heading2"><h2 id="Adverbio">Advérbio</h2></div><ol><li>sem pressa, lentamente<dl><dd>exemplo</dd></dl></li><li>com calma</li></ol>
      <div class="mw-heading mw-heading3"><h3 id="Sinonimos">Sinônimos</h3></div><ul><li><a>lentamente</a>, <a>vagarosamente</a></li></ul>
      <div class="mw-heading mw-heading2"><h2 id="Adjetivo">Adjetivo</h2></div><ol><li>que é lento</li></ol>
      <div class="mw-heading mw-heading2"><h2 id="Etimologia">Etimologia</h2></div><dl><dd>De vagar.</dd></dl>
      <div class="mw-heading mw-heading2"><h2 id="Anagramas">Anagramas</h2></div><ol><li><a>gravade</a></li></ol>
      <div class="mw-heading mw-heading1"><h1 id="Inglês">Inglês</h1></div><ol><li>não deve aparecer</li></ol></div>`;
    route.fulfill({ json: { parse: { title: word, text } } });
  });
}

test('vocabulário: selecionar uma palavra no artigo, ver o significado e virar card', async ({ page }) => {
  await dicionarioFalso(page);
  await semear(page, { books: [artigo('a1')] });
  await page.goto('/#/artigo/a1');
  const palavra = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#reader-body p')][0].firstChild;
    const m = t.data.match(/\p{L}{4,}/u);
    const r = document.createRange();
    r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    return m[0];
  });
  await page.getByRole('button', { name: 'Significado' }).click();
  await expect(page.locator('.word-defs li')).toHaveText(['sem pressa, lentamente', 'com calma', 'que é lento']);
  await expect(page.locator('.word-modal .word-ctx')).toContainText(palavra);
  await page.getByRole('button', { name: 'Salvar e criar card' }).click();
  await expect.poll(async () => (await lerBanco(page, 'words')).map((w) => w.word)).toEqual([palavra.toLowerCase()]);
  const [c] = await lerBanco(page, 'cards');
  expect(c.front).toContain(palavra.toLowerCase());
  // verso completo: todos os sentidos por classe, depois sinônimos e anagramas (anagrama não vira sentido)
  expect(c.back).toBe('**Advérbio**\n1. sem pressa, lentamente\n2. com calma\n\n**Adjetivo**\n1. que é lento\n\n**Sinônimos:** lentamente, vagarosamente\n**Anagramas:** gravade');
  await page.goto('/#/vocabulario');
  await expect(page.locator('#word-list .word-item')).toHaveCount(1);
  await expect(page.locator('#word-list .word-item')).toContainText('card');
});

test('vocabulário: procurar uma palavra digitando (livro de papel)', async ({ page }) => {
  await dicionarioFalso(page);
  await semear(page);
  await page.goto('/#/notas');
  await page.getByRole('link', { name: 'Palavras' }).click();
  await page.getByPlaceholder('Procurar uma palavra…').fill('Devagar,');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('.word-modal .word-title')).toHaveText('devagar');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('#word-list .word-item')).toHaveCount(1);
});

test('excluir uma nota some da tela e avisa', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Nota que vai embora.'), nota('n2', 'b1', 'Nota que fica.')] });
  await page.goto('/#/nota/n1');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Mais/ }).click(); // ações menos usadas ficam no Mais
  await page.getByRole('button', { name: 'Excluir nota' }).click();
  await expect(page).toHaveURL(/#\/notas$/);
  await expect(page.getByText('Nota excluída')).toBeVisible();
  await expect(page.locator('#note-list .note')).toHaveCount(1);
  await expect(page.locator('#note-list')).not.toContainText('vai embora');
});

test('revisão: cada resposta passa para o próximo card, e toque duplo não pula um card sem ver @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'x')], cards: [card('c1', 'b1', 'n1'), card('c2', 'b1', 'n1', { front: 'Segundo card' }), card('c3', 'b1', 'n1', { front: 'Terceiro card' })] });
  await page.goto('/#/revisar');
  await page.getByRole('button', { name: /Revisar 3 cards agora/ }).click();
  await page.getByRole('button', { name: /Mostrar resposta/ }).click();
  await page.getByRole('button', { name: /^Fácil/ }).dblclick();
  await expect(page.getByText('1 feitas · 2 restantes')).toBeVisible();
  await expect(page.getByRole('button', { name: /Mostrar resposta/ })).toBeVisible();
  await page.waitForTimeout(400); // logo depois de responder, o Mostrar resposta ignora toques (proteção do toque duplo)
  await page.getByRole('button', { name: /Mostrar resposta/ }).click();
  await page.getByRole('button', { name: /^Errei/ }).click();
  await expect(page.getByText('2 feitas · 2 restantes')).toBeVisible();
  await expect.poll(async () => (await lerBanco(page, 'reviews')).length).toBe(2);
});

test('duas abas abertas: o que é excluído numa some da outra', async ({ page, context }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Nota que vai embora.'), nota('n2', 'b1', 'Nota que fica.')] });
  const outra = await context.newPage();
  await modoPessoal(outra);
  await outra.goto('/#/notas');
  await expect(outra.locator('#note-list .note')).toHaveCount(2);
  await page.goto('/#/nota/n1');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Mais/ }).click(); // ações menos usadas ficam no Mais
  await page.getByRole('button', { name: 'Excluir nota' }).click();
  await expect(outra.locator('#note-list .note')).toHaveCount(1);
  await expect(outra.locator('#note-list')).not.toContainText('vai embora');
});

test('nota: mudar a página não fecha a janela (Enter vai para o próximo campo; sair pergunta) @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Texto da nota', { page: 12 })] });
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Mais opções…' }).click();
  const aberta = () => page.evaluate(() => document.querySelector('#modal').open);
  const pg = page.locator('#note-form [name=page]');
  await pg.fill('34');
  await pg.press('Enter');
  expect(await aberta()).toBe(true);
  // Esc / voltar do Android com algo mudado: pergunta; "não" mantém a janela
  page.once('dialog', (d) => d.dismiss());
  await page.keyboard.press('Escape');
  expect(await aberta()).toBe(true);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes'))[0].page).toBe(34);
});

// mapa com dois temas: ideias citadas nas notas dos dois livros
const mapaSemente = () => ({
  books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', author: 'James Clear', genre: 'Produtividade', subtheme: 'Rotina' })],
  notes: [
    nota('n1', 'b1', 'O [[Sistema 1]] decide rápido e confia na intuição automática do cérebro.'),
    nota('n2', 'b2', 'Hábitos são [[Automatismo]]: o cérebro decide rápido sem pensar, pela intuição automática.'),
    nota('n3', 'b1', 'Uma reflexão sem ligação nenhuma ainda.'),
  ],
});

test('mapa: tocar num ponto abre o modo foco, com caminho, passos e notas no painel', async ({ page }) => {
  await semear(page, mapaSemente());
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'rede')); // estes testes são da rede de pontos
  await page.goto('/#/mapa');
  await page.locator('#graph-search').fill('Sistema 1');
  await page.locator('#graph-search').press('Enter');
  const trilha = page.locator('#map-trail');
  await expect(trilha).toBeVisible();
  await expect(trilha).toContainText('Mapa geral');
  await expect(trilha.locator('b')).toHaveText('Sistema 1');
  await expect(page.locator('#graph-panel .map-note')).toHaveCount(1);
  await expect(page.locator('#graph-panel')).toContainText('Rápido e Devagar');
  // vai para o vizinho pelo painel: o caminho cresce
  await page.locator('#graph-panel [data-focus="b:b1"]').click();
  await expect(trilha).toContainText('Sistema 1');
  await expect(trilha.locator('b')).toHaveText('Rápido e Devagar');
  await page.getByRole('button', { name: '2 passos' }).click();
  await expect(page.getByRole('button', { name: '2 passos' })).toHaveClass(/active/);
  await page.getByRole('button', { name: /Mapa geral/ }).click();
  await expect(trilha).toBeHidden();
});

test('mapa: sugestão por palavras em comum e "Ligar com…" cria a nota com o porquê', async ({ page }) => {
  await semear(page, mapaSemente());
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'rede')); // estes testes são da rede de pontos
  await page.goto('/#/mapa');
  await page.locator('#graph-search').fill('Sistema 1');
  await page.locator('#graph-search').press('Enter');
  await expect(page.locator('#map-sugg')).toContainText('Automatismo');
  await page.locator('#map-sugg [data-sugg-link]').first().click();
  await expect(page.locator('#connect-form [name=to]')).toHaveValue('Automatismo');
  await page.locator('#connect-form [name=why]').fill('os dois são decisões sem esforço');
  await page.locator('#connect-form').getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes')).find((n) => n.source === 'map')?.text).toBe('[[Sistema 1]] ↔ [[Automatismo]] — os dois são decisões sem esforço');
  // o mapa volta no mesmo foco, agora com a ligação
  await expect(page.locator('#map-trail b')).toHaveText('Sistema 1');
  await expect(page.locator('#graph-panel [data-focus="c:automatismo"]')).toBeVisible();
});

test('mapa: nota sem ligação aparece na caixa e pode ser ligada a uma ideia', async ({ page }) => {
  await semear(page, mapaSemente());
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'rede')); // estes testes são da rede de pontos
  await page.goto('/#/mapa');
  const caixa = page.locator('details.orphans');
  await caixa.locator('summary').click();
  await expect(caixa).toContainText('Uma reflexão sem ligação');
  await caixa.getByRole('button', { name: 'Ligar' }).click();
  await page.locator('#connect-form [name=to]').fill('Sistema 1');
  await page.locator('#connect-form').getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes')).find((n) => n.id === 'n3').text).toContain('→ [[Sistema 1]]');
  await expect(page.locator('details.orphans')).toHaveCount(0);
});

test('PDF em duas colunas: seleção que escorrega para a outra coluna fica na coluna do começo', async ({ page }) => {
  await page.goto('/#/privacidade'); // qualquer página do app serve: o teste monta a camada de texto
  const r = await page.evaluate(async () => {
    const { columnText } = await import('/js/pdf.js');
    const layer = Object.assign(document.createElement('div'), { className: 'textLayer' });
    layer.style.cssText = 'position:relative;width:600px;height:400px';
    document.body.append(layer);
    const lines = [];
    // como no pdf.js: o texto vem coluna por coluna (toda a esquerda, depois a direita)
    for (const [col, x] of [['E', 10], ['D', 320]]) {
      for (let i = 0; i < 6; i++) {
        const s = document.createElement('span');
        s.textContent = `${col}${i} linha da coluna ${col === 'E' ? 'esquerda' : 'direita'}`;
        s.style.cssText = `position:absolute;left:${x}px;top:${20 + i * 20}px;white-space:nowrap;font-size:12px`;
        layer.append(s);
        lines.push(s);
      }
    }
    const at = (col, i) => lines[(col === 'E' ? 0 : 6) + i].firstChild;
    const range = (a, b) => { const x = document.createRange(); x.setStart(a, 0); x.setEnd(b, b.length); return x; };
    return {
      escorregou: columnText(range(at('E', 1), at('D', 3))), // começa na esquerda, fim cai na direita mais abaixo
      continua: columnText(range(at('E', 4), at('D', 1))), // fim acima, na direita: continua no topo da coluna seguinte
      mesma: columnText(range(at('E', 1), at('E', 2))),
    };
  });
  expect(r.escorregou).toBe('E1 linha da coluna esquerda E2 linha da coluna esquerda E3 linha da coluna esquerda');
  expect(r.continua).toBe('E4 linha da coluna esquerda E5 linha da coluna esquerda D0 linha da coluna direita D1 linha da coluna direita');
  expect(r.mesma).toBeNull(); // mesma coluna: vale a seleção normal
});

test('artigo: mudar o nome atualiza as notas que citavam o nome antigo; artigo só com link mostra o original', async ({ page }) => {
  await semear(page, { books: [artigo('a1', { genre: 'Psicologia' }), artigo('a2', { title: 'Link do SciELO', blocks: [], url: 'https://www.scielosp.org/article/x/' }), livro('b1')],
    notes: [nota('n1', 'b1', 'Ver [[Por que ler devagar ajuda a lembrar]] sobre isso.')] });
  await page.goto('/#/artigo/a1');
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Nome').fill('Ler devagar');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('heading', { name: 'Ler devagar', level: 1 })).toBeVisible();
  await expect.poll(async () => (await lerBanco(page, 'notes'))[0].text).toBe('Ver [[Ler devagar]] sobre isso.');
  await page.goto('/#/artigo/a2');
  await expect(page.locator('#reader-body')).toContainText('guardado só como link');
  await expect(page.getByRole('link', { name: /site original/ })).toHaveAttribute('href', 'https://www.scielosp.org/article/x/');
});

test('nota: editar o texto ali mesmo, num campo comum do aparelho @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Texto antigo da nota.', { tags: ['mente'] })] });
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: 'Editar' }).click();
  const campo = page.getByRole('textbox', { name: 'Texto da nota' });
  await expect(campo).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('#modal').open)).toBe(false); // nada de janela por cima
  await campo.fill('Texto novo, editado direto.');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('#note-body')).toHaveText('Texto novo, editado direto.');
  const [n] = await lerBanco(page, 'notes');
  expect(n.text).toBe('Texto novo, editado direto.');
  expect(n.tags).toEqual(['mente']);
});

test('computador: sem atalho de câmera; na nota dá para escolher uma imagem', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await expect(page.getByRole('button', { name: 'Nova' })).toBeVisible();
  await expect(page.locator('[data-action="scan"]')).toHaveCount(0);
  await page.goto('/#/livro/b1');
  await expect(page.getByRole('button', { name: 'Registrar leitura' })).toBeVisible();
  await expect(page.locator('[data-action="scan"]')).toHaveCount(0);
  await page.locator('.quick').getByRole('button', { name: 'Nota' }).click(); // no lugar do Grifo
  await expect(page.getByRole('button', { name: 'Câmera' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Escolher imagem' })).toBeVisible();
  await expect(page.locator('#ocr-status')).toContainText('Tem uma foto da página?');
});

test('grifo: "📷 Grifo" não abre a câmera sozinho, deixa escolher @so-celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  let abriu = false;
  page.on('filechooser', () => { abriu = true; });
  await page.getByRole('button', { name: 'Grifo' }).first().click();
  await expect(page.locator('.ocr-box.pick')).toBeVisible();
  await page.waitForTimeout(500);
  expect(abriu).toBe(false);
  await expect(page.getByRole('button', { name: 'Câmera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Galeria' })).toBeVisible();
});

test('mapa: compartilhar o mapa como imagem (estúdio de artes lendo o mapa)', async ({ page }) => {
  await semear(page, mapaSemente());
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'rede')); // estes testes são da rede de pontos
  await page.goto('/#/mapa');
  await expect(page.locator('#graph-legend a')).toHaveCount(2);
  await page.getByRole('button', { name: 'Compartilhar mapa como imagem' }).click();
  await expect(page.locator('#studio-preview img')).toBeVisible({ timeout: 20_000 });
});

test('planos: grátis, Plus e Pro, com preço mensal e anual', async ({ page }) => {
  await semear(page);
  await page.goto('/#/plus');
  await expect(page.locator('.plan-card')).toHaveCount(3);
  await expect(page.locator('.plan-card h3')).toHaveText(['Grátis', /Plus/, /Pro/]); // os emojis viram ícones
  await expect(page.locator('.plan-card.featured')).toContainText('Mais escolhido');
  await expect(page.locator('.plan-card').nth(1)).toContainText('IA avançada: 12 por mês');
  await expect(page.locator('.plan-card').nth(2)).toContainText('IA avançada: 20 por mês');
  await expect(page.locator('.plan-card').nth(1).locator('.plan-price')).toHaveText('R$ 12,90/mês');
  await page.getByRole('button', { name: /Anual/ }).click();
  await expect(page.locator('.plan-card').nth(2).locator('.plan-price')).toHaveText('R$ 299/ano');
});

test('nota: menções sem ligação viram [[ ]] com um toque (e "ligar todas")', async ({ page }) => {
  await semear(page, { books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', author: 'James Clear', genre: 'Produtividade' })],
    notes: [nota('n1', 'b1', 'O [[Sistema 1]] é rápido.'), nota('n2', 'b1', 'O sistema 1 lembra o que li em hábitos atômicos sobre rotina.')] });
  await page.goto('/#/nota/n2');
  const caixa = page.locator('.mentions');
  await expect(caixa.locator('.chip')).toHaveText(['Hábitos Atômicos', 'Sistema 1']); // o ＋ vira ícone
  await caixa.getByRole('button', { name: 'Sistema 1' }).click();
  await expect.poll(async () => (await lerBanco(page, 'notes')).find((n) => n.id === 'n2').text).toBe('O [[Sistema 1|sistema 1]] lembra o que li em hábitos atômicos sobre rotina.');
  await expect(page.locator('#note-body')).toContainText('O sistema 1 lembra'); // o texto continua igual na leitura
  await page.locator('.mentions .chip').first().click();
  await expect.poll(async () => (await lerBanco(page, 'notes')).find((n) => n.id === 'n2').text).toContain('[[Hábitos Atômicos|hábitos atômicos]]');
  await expect(page.locator('.mentions')).toHaveCount(0);
});

test('início: resgate do dia mostra grifos antigos; manter, virar card e não mostrar mais @celular', async ({ page }) => {
  const antigo = Date.now() - 40 * 864e5;
  await semear(page, { books: [livro('b1')], notes: [
    nota('n1', 'b1', 'Primeiro grifo antigo com texto suficiente.', { createdAt: antigo }),
    nota('n2', 'b1', 'Segundo grifo antigo com texto suficiente.', { createdAt: antigo }),
    nota('n3', 'b1', 'Terceiro grifo antigo com texto suficiente.', { createdAt: antigo }),
    nota('n4', 'b1', 'Grifo novo de hoje ainda não entra.'),
  ] });
  await page.goto('/#/');
  const card = page.locator('.resurface');
  await expect(card).toContainText('1 de 3');
  await expect(card).toContainText('há 1 mês');
  await card.getByRole('button', { name: 'Manter' }).click();
  await expect(card).toContainText('2 de 3');
  await card.getByRole('button', { name: 'Não mostrar mais' }).click();
  await expect(card).toContainText('3 de 3');
  await card.getByRole('button', { name: 'Virar card' }).click();
  await expect(page.locator('#modal')).toBeVisible(); // formulário do card, já com o grifo
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('.resurface-done')).toContainText('3 grifos revisitados');
  const settings = await page.evaluate(async () => (await import('/js/db.js')).db.getKV('settings'));
  expect(settings.resurfaceOff).toHaveLength(1);
  expect(settings.resurface.ids).not.toContain('n4');
});

test('referências: ABNT e APA do livro, completar dados e citar um grifo', async ({ page }) => {
  await semear(page, { books: [livro('b1', { title: 'Rápido e devagar: duas formas de pensar' })], notes: [nota('n1', 'b1', 'O Sistema 1 é rápido.', { page: 21 })] });
  await page.goto('/#/livro/b1');
  await page.getByRole('button', { name: /Mais/ }).click();
  await page.getByRole('button', { name: /Referência/ }).click();
  const box = page.locator('.ref-modal .ref-box');
  await expect(box).toHaveText('KAHNEMAN, Daniel. Rápido e devagar: duas formas de pensar. [S. l.]: [s. n.], [s. d.].');
  await expect(page.locator('.ref-missing')).toContainText('Editora, Cidade, Ano');
  await page.getByLabel('Editora').fill('Objetiva');
  await page.getByLabel('Cidade').fill('Rio de Janeiro');
  await page.getByLabel('Ano').fill('2012');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(box).toHaveText('KAHNEMAN, Daniel. Rápido e devagar: duas formas de pensar. Rio de Janeiro: Objetiva, 2012.');
  await page.getByRole('button', { name: 'APA' }).click();
  await expect(page.locator('.ref-modal .ref-box')).toHaveText('Kahneman, D. (2012). Rápido e devagar: duas formas de pensar. Objetiva.');
  await page.getByRole('button', { name: 'ABNT' }).click();
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: /Mais/ }).click();
  await page.getByRole('button', { name: /Citar/ }).click();
  await expect(page.locator('.ref-modal .ref-box').first()).toHaveText('“O Sistema 1 é rápido.” (KAHNEMAN, 2012, p. 21)');
});

const arvoreSemente = () => ({
  books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', author: 'James Clear', genre: 'Produtividade', subtheme: 'Rotina' })],
  notes: [nota('n1', 'b1', 'O [[Sistema 1]] decide rápido.'), nota('n2', 'b2', 'Hábitos são [[Sistema 1]] treinado.')],
});
const galho = (page, path) => page.locator(`#galhos [data-path="${path}"]`);

test('mapa em galhos: abre e fecha galhos, muda o centro e busca @celular', async ({ page }) => {
  await semear(page, arvoreSemente());
  await page.goto('/#/mapa');
  await expect(galho(page, 'root')).toContainText('Minha biblioteca');
  await expect(galho(page, 'root/theme:psicologia')).toBeVisible();
  await expect(galho(page, 'root/theme:psicologia/subtheme:psicologia|vieses')).toHaveCount(0); // fechado
  await galho(page, 'root/theme:psicologia').click();
  await expect(galho(page, 'root/theme:psicologia/subtheme:psicologia|vieses')).toBeVisible();
  await expect(page.locator('#galhos-panel')).toContainText('Psicologia');
  await page.locator('#galhos-panel').getByRole('button', { name: /Centralizar aqui/ }).click();
  await expect(galho(page, 'root')).toContainText('Psicologia');
  await expect(page.locator('#galhos-trail')).toContainText('Minha biblioteca');
  // busca leva a ideia para o centro, com os livros que a citam
  await page.locator('#galhos-search').fill('sistema');
  await page.locator('#galhos-search').press('Enter');
  await expect(galho(page, 'root')).toContainText('Sistema 1');
  await expect(page.locator('#galhos [data-path^="root/ideaBook:"]')).toHaveCount(2);
  await page.locator('#galhos-trail').getByRole('button', { name: /Minha biblioteca/ }).click();
  await expect(galho(page, 'root')).toContainText('Minha biblioteca');
});

test('mapa: trocar entre galhos, rede e quadros', async ({ page }) => {
  await semear(page, arvoreSemente());
  await page.goto('/#/mapa');
  await expect(page.locator('#galhos')).toBeVisible();
  await page.getByRole('button', { name: 'Rede' }).click();
  await expect(page.locator('#graph')).toBeVisible();
  await page.getByRole('button', { name: 'Quadros' }).click();
  await expect(page.getByRole('button', { name: /Novo quadro/ })).toBeVisible();
  await page.goto('/#/mapa'); // lembra o último modo
  await expect(page.getByRole('button', { name: /Novo quadro/ })).toBeVisible();
});

test('quadro livre: cartões de grifo e texto, seta com rótulo e arrastar', async ({ page }) => {
  await semear(page, arvoreSemente());
  await page.evaluate(() => localStorage.setItem('grifo.mapMode', 'quadros'));
  await page.goto('/#/mapa');
  await page.getByRole('button', { name: /Novo quadro/ }).click();
  await page.getByLabel('Nome').fill('TCC capítulo 2');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page).toHaveURL(/#\/quadro\//);
  await page.getByRole('button', { name: /Grifo/ }).click();
  await page.locator('#pick-q').fill('decide');
  await page.locator('[data-pick="n1"]').click();
  await page.getByRole('button', { name: /Texto/ }).click();
  await page.locator('#btext-form textarea').fill('Minha tese');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const cards = page.locator('.bcard');
  await expect(cards).toHaveCount(2);
  // ligar: 🔗 no grifo, depois o texto
  await cards.first().click();
  await cards.first().getByRole('button', { name: 'Ligar a outro cartão' }).click();
  await expect(page.locator('#board-hint')).toBeVisible();
  await cards.nth(1).click();
  await page.locator('#edge-form [name=label]').fill('explica');
  await page.locator('#edge-form').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.bedge-label')).toHaveText('explica');
  // arrastar o texto e conferir que salvou a posição
  const box = await cards.nth(1).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => {
    const [b] = await lerBanco(page, 'boards');
    return b && b.edges.length === 1 && b.items.length === 2 && b.items.find((i) => i.type === 'text').x > 0 ? b.title : '';
  }).toBe('TCC capítulo 2');
});

test('celular: ações secundárias no "Mais" e filtros recolhidos com contador @so-celular', async ({ page }) => {
  await semear(page, { books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', genre: 'Produtividade' })], notes: [nota('n1', 'b1', 'Uma nota.'), nota('n2', 'b2', 'Outra nota.')] });
  await page.goto('/#/nota/n1');
  await expect(page.locator('.quick .btn')).toHaveCount(4); // Criar card, Editar, Post, Mais
  await page.getByRole('button', { name: /Mais/ }).click();
  await expect(page.locator('#modal.sheet .sheet-item')).toContainText(['Cards com IA', 'Sugerir conexões']);
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.goto('/#/notas');
  const panel = page.locator('[data-filters="notesScope"]');
  await expect(panel).toBeHidden(); // no celular começam recolhidos
  await page.getByRole('button', { name: /Filtros/ }).click();
  await expect(panel).toBeVisible();
  await page.getByRole('combobox', { name: 'Todos os temas' }).fill('produt');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Filtros · 1/ })).toBeVisible();
  await expect(page.locator('#note-list .note')).toHaveCount(1);
});
