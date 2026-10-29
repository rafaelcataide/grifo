// Fluxos principais do Grifo, do jeito que a pessoa usa (mouse, toque, teclado).
// Cada teste começa com o navegador limpo, em modo pessoal e com poucos dados de exemplo.
import { test, expect } from '@playwright/test';
import { modoPessoal, semear, livro, artigo, nota, card, lerBanco, pdfDeTeste } from './ajuda.mjs';

test.beforeEach(async ({ page }) => {
  await modoPessoal(page);
  page.on('pageerror', (e) => { throw new Error(`Erro na página: ${e.message}`); });
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
  await page.goto('/#/mapa');
  await page.locator('[data-map-show=tags]').uncheck();
  await page.locator('#graph-search').fill('Umbanda');
  await page.locator('#graph-search').press('Enter');
  await expect(page.locator('#graph-panel .chip').first()).toHaveText('Ideia');
});

test('mapa: filtro por tema digitando no campo', async ({ page }) => {
  await semear(page, { books: [livro('b1'), livro('b2', { title: 'Hábitos Atômicos', author: 'James Clear', genre: 'Produtividade' })] });
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

test('post da citação: escolher tema e cor desenha a arte', async ({ page }) => {
  await semear(page, { books: [livro('b1')], notes: [nota('n1', 'b1', 'Ler devagar é a forma mais rápida de lembrar.')] });
  await page.goto('/#/nota/n1');
  await page.getByRole('button', { name: 'Criar post' }).click();
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
  for (const r of ['#/', '#/livros', '#/artigos', '#/artigo/a1', '#/notas', '#/mapa', '#/revisar', '#/busca', '#/tags', '#/vocabulario', '#/ajustes', '#/plus']) {
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

test('OCR: depois da foto, dá para marcar só a área que vai ser lida @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Nova' }).click();
  // uma imagem pequena qualquer (PNG 1x1 ampliado pelo navegador)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('#ocr-file').setInputFiles({ name: 'pagina.png', mimeType: 'image/png', buffer: png });
  const crop = page.locator('#ocr-crop');
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
  await expect(page.locator('#ocr-status')).toContainText('Fotografe a página');
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

test('grifo: "📷 Grifo" não abre a câmera sozinho, deixa escolher', async ({ page }) => {
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
