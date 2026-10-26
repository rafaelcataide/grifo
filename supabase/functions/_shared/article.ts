// Baixa uma página e devolve o texto limpo (modo leitura), usado pela função "article".
import { Readability } from "npm:@mozilla/readability@0.6.0";
import { parseHTML } from "npm:linkedom@0.18.12";

const MAX_BYTES = 3_000_000;
const MAX_TEXT = 150_000;

// Só endereços públicos: nada de localhost, IPs de rede interna ou portas estranhas
export function safeUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return null; // IP direto (inclui rede interna)
  return u;
}

async function download(start: URL): Promise<{ html: string; url: URL }> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrifoBot/1.0; +leitura)", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = safeUrl(new URL(res.headers.get("location")!, url).toString());
      if (!next) throw new Error("O link redireciona para um endereço não permitido.");
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`A página respondeu com erro (${res.status}).`);
    const type = res.headers.get("content-type") || "";
    if (!/html|xml/.test(type)) throw new Error("Esse link não é uma página de texto (PDF e imagens ainda não são lidos).");
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size > MAX_BYTES ? MAX_BYTES : size);
    let o = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, buf.length - o)), o); o += c.length; if (o >= buf.length) break; }
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] || "utf-8";
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); } catch { html = new TextDecoder().decode(buf); }
    return { html, url };
  }
  throw new Error("Redirecionamentos demais.");
}

// Texto do artigo em blocos simples: título, parágrafo, citação ou item de lista
function blocks(contentHtml: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`);
  const out: { t: string; x: string }[] = [];
  let total = 0;
  for (const el of document.querySelectorAll("h1,h2,h3,h4,p,blockquote,li,pre")) {
    if (el.querySelector("p,li,blockquote")) continue; // evita repetir texto de blocos aninhados
    const x = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!x) continue;
    const tag = el.tagName.toLowerCase();
    const t = tag.startsWith("h") ? "h" : tag === "blockquote" ? "q" : tag === "li" ? "li" : "p";
    out.push({ t, x });
    total += x.length;
    if (total > MAX_TEXT) break;
  }
  // páginas sem <p> (parágrafos separados por <br><br>): usa o texto inteiro, quebrado nas linhas em branco
  const full = (document.body?.innerHTML || "").replace(/<br\s*\/?>/gi, "\n");
  const { document: d2 } = parseHTML(`<!doctype html><html><body>${full}</body></html>`);
  const text = (d2.body?.textContent || "").replace(/[ \t]+/g, " ");
  if (total < text.replace(/\s+/g, " ").trim().length * 0.6) {
    return text.split(/\n\s*\n/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 1).slice(0, 2000).map((x) => ({ t: "p", x }));
  }
  return out;
}

export async function fetchArticle(url: URL) {
  const { html, url: finalUrl } = await download(url);
  const { document } = parseHTML(html);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const article = new Readability(document as unknown as Document, { charThreshold: 300 }).parse();
  const body = article?.content ? blocks(article.content) : [];
  if (!body.length) throw new Error("Não consegui extrair o texto dessa página (pode exigir login ou ser só vídeo).");
  let image = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
  try { image = image ? new URL(image, finalUrl).toString() : ""; } catch { image = ""; }
  return {
    url: finalUrl.toString(),
    title: (article?.title || meta('meta[property="og:title"]') || finalUrl.hostname).slice(0, 300),
    byline: (article?.byline || meta('meta[name="author"]') || "").slice(0, 200),
    site: (article?.siteName || meta('meta[property="og:site_name"]') || finalUrl.hostname.replace(/^www\./, "")).slice(0, 120),
    excerpt: (article?.excerpt || meta('meta[name="description"]') || "").slice(0, 400),
    published: (article?.publishedTime || meta('meta[property="article:published_time"]') || "").slice(0, 40),
    lang: (article?.lang || document.documentElement?.getAttribute("lang") || "").slice(0, 10),
    image: image.startsWith("https://") ? image : "",
    blocks: body,
  };
}
