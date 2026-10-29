// Câmera do Grifo para grifos, com a câmera falsa do Chromium (vídeo de teste, sem pedir permissão)
import { test, expect } from '@playwright/test';
import { modoPessoal, semear, livro } from './ajuda.mjs';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] });

test.beforeEach(async ({ page }) => {
  await modoPessoal(page);
  page.on('pageerror', (e) => { throw new Error(`Erro na página: ${e.message}`); });
});

test('câmera do Grifo: abre por cima da nota, tira a foto e segue para escolher a área @celular', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Grifo' }).first().click();
  await page.evaluate(() => localStorage.setItem('grifo.camAuto', '0')); // foto só pelo botão: o teste não depende do vídeo parecer firme
  await page.getByRole('button', { name: 'Câmera' }).click();
  const cam = page.locator('dialog.cam');
  await expect(cam).toBeVisible();
  await expect(cam.locator('video')).toHaveJSProperty('paused', false);
  await expect(cam).toHaveAttribute('data-ready', '1');
  const shutter = cam.locator('.cam-shutter');
  await shutter.dispatchEvent('click'); // clique direto: o vídeo ao vivo deixa a checagem de "parado" do Playwright instável
  await expect(cam).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#ocr-crop')).toBeVisible({ timeout: 20_000 }); // a foto chegou: agora escolhe a área
  await page.locator('#crop-cancel').click();
});

test('câmera do Grifo: fechar não muda nada', async ({ page }) => {
  await semear(page, { books: [livro('b1')] });
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Grifo' }).first().click();
  await page.evaluate(() => localStorage.setItem('grifo.camAuto', '0')); // foto só pelo botão: o teste não depende do vídeo parecer firme
  await page.getByRole('button', { name: 'Câmera' }).click();
  const cam = page.locator('dialog.cam');
  await expect(cam).toHaveAttribute('data-ready', '1');
  await cam.getByRole('button', { name: 'Fechar' }).dispatchEvent('click');
  await expect(cam).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('#ocr-crop')).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('#modal').open)).toBe(true);
});
