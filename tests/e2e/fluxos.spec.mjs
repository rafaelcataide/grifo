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
  await page.getByRole('button', { name: 'Abrir PDF' }).click();
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
  for (const r of ['#/', '#/livros', '#/artigos', '#/artigo/a1', '#/notas', '#/mapa', '#/revisar', '#/busca', '#/ajustes', '#/plus']) {
    await page.goto(`/${r}`);
    await page.waitForTimeout(300);
  }
  // textos do próprio usuário (títulos, notas) não entram na conta
  const faltando = await page.evaluate(() => [...(globalThis.__i18nMissing || [])].filter((s) => !/Rápido e Devagar|Kahneman|Vieses|Psicologia|Por que ler devagar|Revista|Ler devagar|Revisar em intervalos|O que é o Sistema 1|Rápido e intuitivo|^RE$|^x$|^#?mente$/.test(s)));
  expect(faltando).toEqual([]);
});
