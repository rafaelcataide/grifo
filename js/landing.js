// Página de apresentação: o que quem ainda não entrou vê ao abrir o link do Grifo.
// As ilustrações são HTML/CSS (sem imagens), então ficam leves, nítidas e seguem o tema claro/escuro.
import { esc } from './util.js';
import { ic } from './icons.js';

const MAP_SVG = `<svg viewBox="0 0 240 150" class="lp-map" aria-hidden="true">
  <circle cx="70" cy="62" r="46" class="isl a"/><circle cx="178" cy="88" r="44" class="isl b"/>
  <line x1="70" y1="50" x2="124" y2="78" class="ln"/><line x1="124" y1="78" x2="178" y2="80" class="ln"/>
  <line x1="52" y1="78" x2="70" y2="50" class="ln"/><line x1="178" y1="80" x2="196" y2="104" class="ln"/>
  <circle cx="70" cy="50" r="7" class="bk a"/><circle cx="52" cy="78" r="6" class="sub a"/>
  <circle cx="178" cy="80" r="7" class="bk b"/><circle cx="196" cy="104" r="6" class="bk b"/>
  <path d="M124 70 L132 78 L124 86 L116 78 Z" class="idea"/>
  <text x="70" y="14" class="lbl">Psicologia</text><text x="178" y="42" class="lbl">Produtividade</text>
  <text x="124" y="100" class="lbl sm">Hábitos</text>
</svg>`;

export function landingView({ invite = false, price = '' } = {}) {
  return `<div class="lp">
  ${invite ? '<a class="lp-invite" href="#/conta">🎈 Você foi convidado: crie sua conta e ganhe <b>1 mês de Grifo Plus</b>.</a>' : ''}
  <header class="lp-hero">
    <img src="icons/icon.svg" alt="" width="64" height="64" class="lp-logo">
    <h1>Suas leituras, grifadas para sempre.</h1>
    <p class="lp-sub">Fotografe a página e o Grifo guarda só o que você marcou com marca-texto. Conecte ideias entre livros e revise para não esquecer o que leu.</p>
    <div class="lp-actions">
      <a class="btn primary lp-cta" href="#/conta">Começar grátis</a>
      <a class="btn ghost" href="#/conta">Já tenho conta</a>
    </div>
    <p class="hint">Grátis para sempre · celular e computador · sem anúncios</p>
    <div class="lp-demo" aria-hidden="true">
      <div class="lp-page">
        <p>Na maior parte do tempo lemos rápido demais. <mark>Ler devagar é a forma mais rápida de lembrar</mark>, porque cada ideia tem tempo de se ligar a outra.</p>
        <span class="lp-cam">${ic('camera')}</span>
      </div>
      <span class="lp-arrow">→</span>
      <div class="lp-note">
        <span class="lp-q">“Ler devagar é a forma mais rápida de lembrar”</span>
        <span class="lp-src">Seu livro · pág. 42</span>
        <span class="lp-tags"><i>memória</i><i>leitura</i></span>
      </div>
    </div>
  </header>

  <section class="lp-features">
    <article class="lp-feat">
      <h3>📷 Só o que você grifou</h3>
      <p>Fotografe a página do livro ou a tela do Kindle: o Grifo encontra o que você marcou, com marca-texto colorido ou o grifo cinza do Kindle, e transforma o trecho em nota.</p>
    </article>
    <article class="lp-feat">
      <h3>🕸️ Um mapa das suas ideias</h3>
      <p>Cada tema vira uma ilha com seus livros. Ligue notas com <b>[[ ]]</b> e veja ideias de livros diferentes se encontrarem.</p>
      ${MAP_SVG}
    </article>
    <article class="lp-feat">
      <h3>🧠 Revise e não esqueça</h3>
      <p>Transforme grifos em cards. Eles voltam no momento certo, como no Anki, para o que você leu ficar.</p>
      <div class="lp-card" aria-hidden="true"><b>O que faz uma ideia ficar na memória?</b>
        <span class="lp-grades"><i>Errei</i><i>Difícil</i><i class="on">Bom</i><i>Fácil</i></span></div>
    </article>
    <article class="lp-feat">
      <h3>🎨 Pronto para o Instagram</h3>
      <p>Citações, sua estante, a retrospectiva do mês e o mapa viram artes bonitas para stories e feed, em um toque.</p>
      <div class="lp-art" aria-hidden="true"><span>“Ler devagar é a forma mais rápida de lembrar.”</span><small>Grifo</small></div>
    </article>
  </section>

  <section class="lp-who">
    <h2>Feito para quem lê de verdade</h2>
    <div class="lp-who-grid">
      <div><h3>📚 Leitores</h3><p>Metas, sequência de leitura, conquistas e clubes do livro com amigos.</p></div>
      <div><h3>🎓 Estudantes e concurseiros</h3><p>Grifo, fichamento e cards de revisão no mesmo lugar, separados por tema e matéria.</p></div>
      <div><h3>💼 Leitura profissional</h3><p>Guarde as ideias dos livros de trabalho e encontre tudo depois, com busca e mapa.</p></div>
    </div>
  </section>

  <section class="lp-import">
    <p><b>Já usa Skoob, Goodreads ou Kindle?</b> Traga sua estante e seus destaques em um minuto.</p>
  </section>

  <section class="lp-plans">
    <h2>Planos</h2>
    <div class="lp-plans-grid">
      <div class="lp-plan"><h3>Grátis</h3><div class="lp-price">R$ 0</div>
        <ul><li>Livros, notas e grifos por foto</li><li>Mapa de ideias e cards de revisão</li><li>Metas, conquistas e clubes</li><li>Sincronização entre aparelhos</li><li>Artes para o Instagram</li></ul></div>
      <div class="lp-plan plus"><h3>⭐ Plus</h3><div class="lp-price">${esc(price)}</div>
        <ul><li>Tudo do grátis</li><li>Pergunte à sua biblioteca com IA</li><li>Cards e conexões sugeridos pela IA</li><li>Estilos extras e artes sem marca</li></ul></div>
    </div>
  </section>

  <section class="lp-faq">
    <h2>Perguntas frequentes</h2>
    <details><summary>Minhas notas ficam públicas?</summary><p>Não. Livros, notas e grifos são só seus. Você escolhe se quer um perfil público, que mostra apenas nível, metas e livros lidos.</p></details>
    <details><summary>Funciona sem internet?</summary><p>Sim. O Grifo funciona offline e sincroniza quando a conexão volta.</p></details>
    <details><summary>Preciso instalar alguma coisa?</summary><p>Não. Abra no navegador do celular e, se quiser, use “Adicionar à tela inicial” para usar como app.</p></details>
    <details><summary>Posso levar meus dados embora?</summary><p>Sim. Em Conta você baixa uma cópia de tudo ou apaga a conta quando quiser.</p></details>
  </section>

  <section class="lp-final">
    <h2>Comece pelo próximo livro.</h2>
    <a class="btn primary lp-cta" href="#/conta">Criar minha conta grátis</a>
    <p class="hint"><a href="#/termos">Termos de uso</a> · <a href="#/privacidade">Privacidade</a></p>
  </section>
</div>`;
}
