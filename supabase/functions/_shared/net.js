// Endereços de rede que o servidor nunca deve acessar a pedido de um usuário: a própria máquina,
// redes internas e endereços reservados. Usado pelo leitor de artigos depois de resolver o nome do site
// (um nome público pode apontar para um IP interno). Sem dependências: testável com node --test.

/** IPv4 em rede interna, de loopback, de link local ou reservada. */
export function isPrivateV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return true; // não é um IPv4 válido: não confia
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return true;
  return a === 0 || a === 10 || a === 127 // "esta rede", interna, a própria máquina
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link local (inclui o endereço de metadados das nuvens)
    || (a === 172 && b >= 16 && b <= 31) // interna
    || (a === 192 && b === 168) // interna
    || (a === 192 && b === 0) // reservada
    || (a === 198 && (b === 18 || b === 19)) // testes de rede
    || a >= 224; // multicast e reservadas
}

/** IPv6 de loopback, local, de link local ou que embute um IPv4 interno. */
export function isPrivateV6(ip) {
  const s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!s.includes(':')) return true;
  if (s === '::' || s === '::1') return true;
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s); // ::ffff:10.0.0.1 e parecidos
  if (v4) return isPrivateV4(v4[1]);
  const first = parseInt(s.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // fc00::/7 (rede local)
    || (first & 0xffc0) === 0xfe80 // fe80::/10 (link local)
    || (first & 0xff00) === 0xff00; // multicast
}

export const isPrivateIp = (ip) => (String(ip).includes(':') ? isPrivateV6(ip) : isPrivateV4(ip));
