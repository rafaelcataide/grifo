// Painel de métricas (admin).
// Parte do app.js separada por tela: usa o estado e os utilitários do app (importados de ../app.js).
import { esc, nf } from '../util.js';
import * as Cloud from '../cloud.js';
import { $, pct, empty } from '../app.js';

// ---------- painel de métricas (admin) ----------
export function adminView() {
  return `<a href="#/conta" class="back">← Conta</a><h2>Painel de métricas</h2>
  <div id="admin-body"><p class="small muted">Carregando…</p></div>`;
}
adminView.mount = async () => {
  const body = $('#admin-body');
  if (!(await Cloud.isAdmin())) { body.innerHTML = empty('Este painel é só para administradores.'); return; }
  let m;
  try { m = await Cloud.adminMetrics(); } catch (e) { body.innerHTML = `<p class="nudge">Não foi possível carregar: ${esc(e.message)}</p>`; return; }
  const pct = (ok, base) => (base ? `${Math.round((ok / base) * 100)}%` : '—');
  const goal = (ok, base, target) => (base ? (ok / base >= target ? 'ok' : 'low') : '');
  const stat = (v, label, cls = '') => `<div class="card stat ${cls}"><b>${v}</b><span>${label}</span></div>`;
  const weeks = m.signups_by_week || [];
  const max = Math.max(1, ...weeks.map((w) => w.n));
  const events = Object.entries(m.events30 || {}).sort((a, b) => b[1] - a[1]);
  body.innerHTML = `
  <section class="grid3">${stat(nf(m.users), 'usuários')}${stat(nf(m.new_7d), 'novos em 7 dias')}${stat(nf(m.mau), 'ativos em 30 dias')}</section>
  <section class="grid3">${stat(nf(m.dau), 'ativos hoje')}${stat(nf(m.wau), 'ativos na semana')}${stat(nf(m.referrals), 'entraram por convite')}</section>
  <h3>Funil</h3>
  <section class="card list">
    <div class="row between li"><span><b>Ativação</b><br><span class="small muted">salvou a 1ª nota em até 24 h (contas dos últimos 30 dias) · meta 40%</span></span><b class="metric ${goal(m.activation.ok, m.activation.base, 0.4)}">${pct(m.activation.ok, m.activation.base)}</b></div>
    <div class="row between li"><span><b>Retenção</b><br><span class="small muted">voltou a usar 7 dias depois de criar a conta · meta 25%</span></span><b class="metric ${goal(m.retention7.ok, m.retention7.base, 0.25)}">${pct(m.retention7.ok, m.retention7.base)}</b></div>
    <div class="row between li"><span><b>Compartilhamento</b><br><span class="small muted">ativos que geraram arte em 30 dias · meta 15%</span></span><b class="metric ${goal(m.sharers30, m.mau, 0.15)}">${pct(m.sharers30, m.mau)}</b></div>
    <div class="row between li"><span><b>Plus</b><br><span class="small muted">${nf(m.plus_paid)} pagantes · ${nf(m.plus_invite)} por convite · meta 2–5% dos ativos</span></span><b class="metric ${goal(m.plus_paid, m.mau, 0.02)}">${pct(m.plus_paid, m.mau)}</b></div>
  </section>
  <h3>Cadastros por semana</h3>
  <section class="card">${weeks.length ? `<div class="weekbars">${weeks.map((w) => `<div class="wb"><span class="wb-n">${w.n}</span><i style="height:${Math.max(4, (w.n / max) * 100)}%"></i><span class="wb-l">${w.week.slice(8, 10)}/${w.week.slice(5, 7)}</span></div>`).join('')}</div>` : '<p class="small muted" style="margin:0">Sem cadastros nas últimas 8 semanas.</p>'}</section>
  <h3>Eventos (30 dias)</h3>
  <section class="card list">${events.length ? events.map(([k, n]) => `<div class="row between li"><span>${esc(EVENT_LABEL[k] || k)}</span><b>${nf(n)}</b></div>`).join('') : '<p class="small muted" style="margin:0">Nenhum evento ainda.</p>'}</section>
  <p class="hint">Ativo = algum livro, nota, card ou leitura mudou no período. As porcentagens ficam mais confiáveis a partir de algumas dezenas de contas.</p>`;
};
export const EVENT_LABEL = { share: 'Artes compartilhadas ou baixadas', invite_share: 'Convites enviados', invite_copy: 'Links de convite copiados', plus_view: 'Visitas à página do Plus' };
