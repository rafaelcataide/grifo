// IA do Grifo: pelo servidor (conta + Plus) ou, no modo pessoal, com a chave da Anthropic do próprio usuário.
import { buildParams, parseResult } from '../supabase/functions/_shared/ai-tasks.js';
import * as Cloud from './cloud.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
let sdkPromise = null;

export function available(settings) {
  if (Cloud.enabled()) return Cloud.user() ? (Cloud.plan() === 'plus' ? 'ok' : 'plus') : 'login';
  return settings.aiKey ? 'ok' : 'key';
}

export async function run(task, input, settings) {
  if (Cloud.enabled()) return Cloud.invokeAI(task, input);
  if (!settings.aiKey) throw new Error('Cadastre sua chave da API da Anthropic em Ajustes para usar a IA.');
  sdkPromise ||= import(SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  const client = new Anthropic({ apiKey: settings.aiKey, dangerouslyAllowBrowser: true });
  try {
    return parseResult(await client.beta.messages.create(buildParams(task, input)));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Chave da API inválida. Confira em Ajustes.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de uso da API atingido. Tente em instantes.');
    if (e instanceof Anthropic.APIError) throw new Error(`Erro da IA (${e.status}).`);
    throw e;
  }
}
