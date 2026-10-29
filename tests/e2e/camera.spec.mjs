// Câmera do Grifo para grifos, com a câmera falsa do Chromium (vídeo de teste, sem pedir permissão)
import { test, expect } from '@playwright/test';
import { modoPessoal, semear, livro } from './ajuda.mjs';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] });

test.beforeEach(async ({ page }) => {
  await modoPessoal(page);
  page.on('pageerror', (e) => { throw new Error(`Erro na página: ${e.message}`); });
});

test('câmera do Grifo: abre por cima da nota, tira a foto sozinha quando firme e segue para escolher a área @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Grifo' }).first().click();
  await page.getByRole('button', { name: 'Câmera' }).click();
  const cam = page.locator('dialog.cam');
  await expect(cam).toBeVisible();
  await expect(cam.locator('video')).toHaveJSProperty('paused', false);
  // o vídeo de teste fica quase parado: a foto automática dispara sozinha quando a imagem está firme
  await expect(cam).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#ocr-crop')).toBeVisible(); // a foto chegou: agora escolhe a área
  await page.locator('#crop-cancel').click();
});

test('câmera do Grifo: fechar não muda nada', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Grifo' }).first().click();
  await page.getByRole('button', { name: 'Câmera' }).click();
  await page.locator('dialog.cam').getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('dialog.cam')).toHaveCount(0);
  await expect(page.locator('#ocr-crop')).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('#modal').open)).toBe(true);
});
