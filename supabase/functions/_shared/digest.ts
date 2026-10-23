// Resumo dos dados de leitura de uma pessoa, calculado no servidor a partir dos registros sincronizados.
// Usado pelas notificações diárias e pelo e-mail semanal.
// deno-lint-ignore-file no-explicit-any

export type Digest = {
  readToday: boolean;
  streak: number;
  dueCards: number;
  weekPages: number;
  weekDays: number;
  weekNotes: number;
  finishedWeek: string[];
  reading: { title: string; currentPage: number; pages: number }[];
  highlight: { text: string; book: string; author: string } | null;
};

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hash = (s: string) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
const plain = (t: string) => String(t || "").replace(/\[\[([^[\]\n]+?)\]\]/g, (_m, x) => x.split("|").pop());

// Data e hora locais da pessoa (fuso do aparelho dela)
export function localNow(tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

export async function digestFor(admin: any, userId: string, today: string): Promise<Digest> {
  const { data: rows } = await admin.from("records").select("store,data")
    .eq("user_id", userId).eq("deleted", false).in("store", ["sessions", "cards", "notes", "books"]);
  const by = (s: string) => (rows || []).filter((r: any) => r.store === s).map((r: any) => r.data || {});
  const sessions = by("sessions"), cards = by("cards"), notes = by("notes"), books = by("books");
  const days = new Set(sessions.filter((s: any) => s.pages > 0).map((s: any) => s.date));

  let streak = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) { streak++; d = addDays(d, -1); }

  const weekStart = addDays(today, -6);
  const inWeek = (x: string) => x >= weekStart && x <= today;
  const weekSessions = sessions.filter((s: any) => inWeek(s.date));
  const weekStartTs = new Date(`${weekStart}T00:00:00Z`).getTime();
  const bookById = new Map(books.map((b: any) => [b.id, b]));

  const pool = notes.filter((n: any) => { const len = plain(n.text).length; return len >= 20 && len <= 400 && bookById.has(n.bookId); });
  const pick = pool.sort((a: any, b: any) => (hash(today + a.id) / (a.fav ? 2.5 : 1)) - (hash(today + b.id) / (b.fav ? 2.5 : 1)))[0];
  const pb: any = pick && bookById.get(pick.bookId);

  return {
    readToday: days.has(today),
    streak,
    dueCards: cards.filter((c: any) => c.due && c.due <= today).length,
    weekPages: weekSessions.reduce((a: number, s: any) => a + (s.pages || 0), 0),
    weekDays: new Set(weekSessions.map((s: any) => s.date)).size,
    weekNotes: notes.filter((n: any) => (n.createdAt || 0) >= weekStartTs).length,
    finishedWeek: books.filter((b: any) => b.status === "finished" && b.endDate && inWeek(b.endDate)).map((b: any) => b.title),
    reading: books.filter((b: any) => b.status === "reading").slice(0, 3).map((b: any) => ({ title: b.title, currentPage: b.currentPage || 0, pages: b.pages || 0 })),
    highlight: pick ? { text: plain(pick.text), book: pb?.title || "", author: pb?.author || "" } : null,
  };
}
