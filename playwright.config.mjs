// Testes de tela (Playwright): abrem o app num navegador de verdade e usam como uma pessoa usaria.
// Local: usa o Chrome instalado. No GitHub (CI): usa o Chromium baixado pelo próprio Playwright.
// Rodar: npm run test:telas   (ou npx playwright test --ui para ver passo a passo)
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const PORT = 5199;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 3,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  webServer: {
    command: `node server.js . ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block', // cada teste busca os arquivos do servidor, sem cache do app
    trace: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [
    // testes só de toque (@so-celular) não rodam no computador
    { name: 'computador', grepInvert: /@so-celular/, use: { ...devices['Desktop Chrome'], channel: CI ? undefined : 'chrome' } },
    // no celular rodam só os testes marcados com @celular ou @so-celular
    { name: 'celular', grep: /@celular|@so-celular/, use: { ...devices['Pixel 7'], channel: CI ? undefined : 'chrome' } },
  ],
});
