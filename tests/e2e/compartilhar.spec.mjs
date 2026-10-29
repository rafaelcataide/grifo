// "Compartilhar → Grifo" no celular: o service worker recebe o PDF (POST do share_target) e o app abre
import { test, expect } from '@playwright/test';
import { modoPessoal, semear, pdfDeTeste } from './ajuda.mjs';

test.use({ serviceWorkers: 'allow' });

test('PDF compartilhado de outro app abre no leitor do Grifo', async ({ page }) => {
  await modoPessoal(page, page.context());
  page.on('pageerror', (e) => { throw new Error(`Erro na página: ${e.message}`); });
  await semear(page);
  await page.goto('/#/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // agora a página é controlada pelo service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // o que o Android faz: POST multipart para a action do share_target
  const final = await page.evaluate(async (bytes) => {
    const fd = new FormData();
    fd.append('pdf', new File([new Uint8Array(bytes)], 'guia compartilhado.pdf', { type: 'application/pdf' }));
    const r = await fetch('/compartilhar', { method: 'POST', body: fd });
    const guardado = await (await caches.open('grifo-compartilhado')).match('pdf');
    return { status: r.status, guardado: !!guardado, nome: guardado && decodeURIComponent(guardado.headers.get('x-name')) };
  }, [...pdfDeTeste()]);
  expect(final).toEqual({ status: 200, guardado: true, nome: 'guia compartilhado.pdf' });
  await page.goto('/#/artigos?acao=pdf');
  await expect(page).toHaveURL(/#\/pdf\//, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Guia de Leitura Lenta' })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(async () => !!(await (await caches.open('grifo-compartilhado')).match('pdf')))).toBe(false); // usado e apagado
});
