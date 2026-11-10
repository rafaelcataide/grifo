// Página de apresentação: o que quem ainda não entrou vê ao abrir o link do Grifo.
// As ilustrações são HTML/CSS (sem imagens), então ficam leves, nítidas e seguem o tema claro/escuro.
import { esc } from './util.js';
import { PLANOS } from '../supabase/functions/_shared/planos.js';
import { ic } from './icons.js';
import { tr } from './i18n.js';

const MAP_SVG = `<svg viewBox="0 0 240 150" class="lp-map" aria-hidden="true" data-no-tr>
  <path d="M38 75 C 70 75, 70 34, 104 34" class="ln"/><path d="M38 75 L 104 75" class="ln"/><path d="M38 75 C 70 75, 70 116, 104 116" class="ln"/>
  <path d="M104 34 C 130 34, 136 20, 160 20" class="ln"/><path d="M104 34 C 130 34, 136 48, 160 48" class="ln"/>
  <path d="M104 75 L 160 75" class="ln"/><path d="M104 116 L 160 116" class="ln"/>
  <path d="M168 75 L 212 75" class="ln dash"/>
  <circle cx="38" cy="75" r="10" class="bk a"/>
  <circle cx="104" cy="34" r="6" class="sub a"/><circle cx="104" cy="75" r="6" class="sub a"/><circle cx="104" cy="116" r="6" class="sub a"/>
  <rect x="155" y="15" width="10" height="10" rx="2" class="note"/><rect x="155" y="43" width="10" height="10" rx="2" class="note"/><rect x="155" y="111" width="10" height="10" rx="2" class="note"/>
  <path d="M160 67 L168 75 L160 83 L152 75 Z" class="idea"/>
  <circle cx="218" cy="75" r="8" class="bk b"/>
  <text x="38" y="100" class="lbl">${tr('Seu livro')}</text>
  <text x="104" y="22" class="lbl sm">${tr('Memória')}</text><text x="104" y="63" class="lbl sm">${tr('Hábitos')}</text><text x="104" y="135" class="lbl sm">${tr('Foco')}</text>
  <text x="218" y="98" class="lbl sm">${tr('outro livro')}</text>
</svg>`;

export function landingView({ invite = false, prices = {} } = {}) {
  return `<div class="lp">
  ${invite ? '<a class="lp-invite" href="#/conta">🎈 Você foi convidado: crie sua conta e ganhe <b>1 mês de Grifo Plus</b>.</a>' : ''}
  <header class="lp-hero">
    <img src="icons/icon.svg" alt="" width="64" height="64" class="lp-logo">
    <h1>Suas leituras, grifadas para sempre.</h1>
    <p class="lp-sub">Fotografe a página ou grife o PDF e o Grifo guarda só o que você marcou. Conecte ideias entre livros e artigos e revise para não esquecer o que leu.</p>
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
      <h3>🌳 Um mapa das suas ideias</h3>
      <p>Abra um livro e veja seus temas e grifos em galhos, como um mapa mental. Ligue notas com <b>[[ ]]</b> e monte <b>quadros</b> para juntar ideias de livros diferentes.</p>
      ${MAP_SVG}
    </article>
    <article class="lp-feat">
      <h3>🧠 Revise e não esqueça</h3>
      <p>Transforme grifos em cards. Eles voltam no momento certo, como no Anki, para o que você leu ficar.</p>
      <div class="lp-card" aria-hidden="true"><b>O que faz uma ideia ficar na memória?</b>
        <span class="lp-grades"><i>Errei</i><i>Difícil</i><i class="on">Bom</i><i>Fácil</i></span></div>
    </article>
    <article class="lp-feat">
      <h3>📄 Artigos e PDFs</h3>
      <p>Traga o artigo por link ou envie o PDF e grife direto nele, até em artigos de duas colunas. Os grifos viram notas, ao lado dos seus livros.</p>
      <div class="lp-pdf" aria-hidden="true"><div><i></i><i class="hl"></i><i></i><i></i></div><div><i></i><i></i><i class="hl"></i><i></i></div></div>
    </article>
    <article class="lp-feat">
      <h3>🔤 Vocabulário</h3>
      <p>Selecione uma palavra e veja o significado na hora, como no Kindle. Ela vai para o seu vocabulário e vira card com definição e sinônimos.</p>
      <div class="lp-word" aria-hidden="true"><b>efêmero</b><span>adj. Que dura pouco; passageiro.</span><small>sinônimos: breve, fugaz, transitório</small></div>
    </article>
    <article class="lp-feat">
      <h3>🔁 Nada fica esquecido</h3>
      <p>Todo dia o Grifo traz de volta uma nota antiga e mostra notas que falam do mesmo assunto mas ainda não estão ligadas.</p>
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
      <div><h3>🎓 Estudantes e pesquisadores</h3><p>Grifo, fichamento, vocabulário e cards de revisão no mesmo lugar. Citações e referências em ABNT ou APA prontas para o trabalho.</p></div>
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
        <ul><li>Livros, notas e grifos por foto</li><li>Até ${PLANOS.free.articles} artigos e PDFs</li><li>Mapa de ideias e ${PLANOS.free.boards} quadro</li><li>Cards de revisão e vocabulário</li><li>Metas, conquistas e clubes</li><li>Sincronização entre aparelhos</li><li>IA para experimentar</li></ul></div>
      <div class="lp-plan plus"><h3>⭐ Plus</h3><div class="lp-price">${esc(prices.plus?.month || '')}<small>/mês</small></div>
        <ul><li>Tudo do grátis</li><li>Pergunte à sua biblioteca com IA</li><li>Fichamento e cards feitos pela IA</li><li>Plano de revisão para provas</li><li>Artigos ilimitados e ${PLANOS.plus.pdfGB} GB para PDFs</li><li>${PLANOS.plus.boards} quadros de ideias</li><li>Temas extras e artes sem marca</li></ul></div>
      <div class="lp-plan"><h3>💎 Pro</h3><div class="lp-price">${esc(prices.pro?.month || '')}<small>/mês</small></div>
        <ul><li>Tudo do Plus</li><li>Citações e referências ABNT/APA</li><li>Lista de referências da estante</li><li>${PLANOS.pro.heavy} usos de IA avançada por mês</li><li>“Perguntar” lê o dobro das suas notas</li><li>Fichamento de livros inteiros</li><li>Quadros ilimitados e ${PLANOS.pro.pdfGB} GB para PDFs</li></ul></div>
    </div>
  </section>

  <section class="lp-faq">
    <h2>Perguntas frequentes</h2>
    <details><summary>Minhas notas ficam públicas?</summary><p>Não. Livros, notas e grifos são só seus. Você escolhe se quer um perfil público, que mostra apenas nível, metas e livros lidos.</p></details>
    <details><summary>Funciona sem internet?</summary><p>Sim. O Grifo funciona offline e sincroniza quando a conexão volta.</p></details>
    <details><summary>Preciso instalar alguma coisa?</summary><p>Não. Abra no navegador do celular e, se quiser, use “Adicionar à tela inicial” para usar como app.</p></details>
    <details><summary>Serve para trabalhos acadêmicos?</summary><p>Sim. Guarde artigos e PDFs, grife, e no Pro copie a citação com a página e a referência em ABNT ou APA, ou a lista de referências inteira.</p></details>
    <details><summary>Posso levar meus dados embora?</summary><p>Sim. Em Conta você baixa uma cópia de tudo ou apaga a conta quando quiser.</p></details>
  </section>

  <section class="lp-final">
    <h2>Comece pelo próximo livro.</h2>
    <a class="btn primary lp-cta" href="#/conta">Criar minha conta grátis</a>
    <p class="hint"><a href="#/termos">Termos de uso</a> · <a href="#/privacidade">Privacidade</a></p>
  </section>
</div>`;
}
