import { GAME_MAP, type GameId } from "@/lib/games";
import type { Sorteio } from "@/lib/types";

const TTL_MS = 10 * 60 * 1000;

const cache = new Map<GameId, { at: number; sorteio: Sorteio }>();

const CAIXA_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0",
  Origin: "https://loterias.caixa.gov.br",
  Referer: "https://loterias.caixa.gov.br/",
};

const DRAW_COUNT: Record<GameId, { count: number; second?: number; trevos?: number }> = {
  megasena: { count: 6 },
  lotofacil: { count: 15 },
  quina: { count: 5 },
  lotomania: { count: 20 },
  duplasena: { count: 6, second: 6 },
  timemania: { count: 7 },
  diadesorte: { count: 7 },
  supersete: { count: 7 },
  maismilionaria: { count: 6, trevos: 2 },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return text || null;
}

function asMoney(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseNumbers(value: unknown, min: number, max: number, unique: boolean): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const nums: number[] = [];
  for (const item of value) {
    const text = String(item).replace(/\u0000/g, "").trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    if (!Number.isInteger(n) || n < min || n > max) return null;
    nums.push(n);
  }
  if (unique && new Set(nums).size !== nums.length) return null;
  return nums;
}

function parseSuperSete(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const nums: number[] = [];
  for (const item of value) {
    const digits = String(item).replace(/\D/g, "");
    if (!digits) return null;
    nums.push(Number(digits.slice(-1)));
  }
  return nums;
}

function adaptPayload(body: unknown): unknown {
  const row = asRecord(body);
  if (!row || row.listaDezenas || row.concurso === undefined || !Array.isArray(row.dezenas)) return body;
  const dezenas = row.dezenas.map((item) => String(item));
  const split = dezenas.length === 12;
  const trevos = Array.isArray(row.trevos) ? row.trevos : [];
  return {
    numero: row.concurso,
    dataApuracao: row.data,
    dataProximoConcurso: row.dataProximoConcurso,
    valorEstimadoProximoConcurso: row.valorEstimadoProximoConcurso,
    acumulado: row.acumulou === true,
    listaDezenas: split ? dezenas.slice(0, 6) : dezenas,
    listaDezenasSegundoSorteio: split ? dezenas.slice(6) : null,
    trevosSorteados: trevos.length ? trevos : null,
    nomeTimeCoracaoMesSorte: cleanText(row.timeCoracao) || cleanText(row.mesSorte),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_LATEST_DAYS = 7;

function brDateUtc(value: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function todayBrUtc(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = parts.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isCurrentDraw(sorteio: Sorteio, now = new Date()): boolean {
  const draw = brDateUtc(sorteio.dataApuracao);
  if (draw === null) return false;
  const age = (todayBrUtc(now) - draw) / DAY_MS;
  return age >= -1 && age <= STALE_LATEST_DAYS;
}

function normalize(jogo: GameId, body: unknown): Sorteio | null {
  const row = asRecord(adaptPayload(body));
  if (!row) return null;
  const numero = typeof row.numero === "number" ? row.numero : Number(row.numero);
  const dataApuracao = cleanText(row.dataApuracao);
  if (!Number.isInteger(numero) || numero < 1 || !dataApuracao || !/^\d{2}\/\d{2}\/\d{4}$/.test(dataApuracao)) return null;

  const game = GAME_MAP[jogo];
  const spec = DRAW_COUNT[jogo];
  const dezenas = jogo === "supersete" ? parseSuperSete(row.listaDezenas) : parseNumbers(row.listaDezenas, game.min, game.max, true);
  if (!dezenas || dezenas.length !== spec.count) return null;

  let dezenasSegundo: number[] = [];
  if (spec.second) {
    const second = parseNumbers(row.listaDezenasSegundoSorteio, game.min, game.max, true);
    if (!second || second.length !== spec.second) return null;
    dezenasSegundo = second;
  }

  let trevos: number[] = [];
  if (spec.trevos) {
    const parsed = parseNumbers(row.trevosSorteados, 1, 6, true);
    if (!parsed || parsed.length !== spec.trevos) return null;
    trevos = parsed;
  }

  return {
    jogo,
    numero,
    dataApuracao,
    dataProximo: cleanText(row.dataProximoConcurso),
    estimativaProximo: asMoney(row.valorEstimadoProximoConcurso),
    dezenas,
    dezenasSegundo,
    trevos,
    extra: cleanText(row.nomeTimeCoracaoMesSorte),
    acumulado: row.acumulado === true,
  };
}

async function pull(url: string, headers?: Record<string, string>, timeoutMs = 12000): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const contestCache = new Map<string, Sorteio>();

async function fromSources(jogo: GameId, sources: Array<() => Promise<unknown>>, expected?: number): Promise<Sorteio> {
  let sawPayload = false;
  let lastError: unknown;
  for (const source of sources) {
    try {
      const sorteio = normalize(jogo, await source());
      if (!sorteio) continue;
      sawPayload = true;
      if (expected !== undefined && sorteio.numero !== expected) continue;
      return sorteio;
    } catch (error) {
      lastError = error;
    }
  }
  if (expected !== undefined && sawPayload) throw new Error("concurso_nao_encontrado");
  throw lastError instanceof Error ? lastError : new Error("resultado_indisponivel");
}

export async function latestDraw(jogo: GameId, fresh = false): Promise<Sorteio> {
  const cached = cache.get(jogo);
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.sorteio;

  const sources = [
    () => pull(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}`, CAIXA_HEADERS, 4000),
    () => pull(`https://api.guidi.dev.br/loteria/${jogo}/ultimo`, undefined, 4000),
    () => pull(`https://api.brasilapifacil.com.br/v1/loteria/${jogo}/ultimo`, undefined, 8000),
    () => pull(`https://raw.githubusercontent.com/maickon/free-apiloterias/refs/heads/master/database/${jogo}/_ultimo.json`, undefined, 4000),
  ];
  const found = await Promise.all(sources.map((source) => source().then((body) => normalize(jogo, body)).catch(() => null)));
  const draws = found
    .filter((item): item is Sorteio => item !== null && isCurrentDraw(item))
    .sort((a, b) => b.numero - a.numero);
  if (!draws.length) throw new Error("resultado_indisponivel");
  const sorteio = draws[0];
  cache.set(jogo, { at: Date.now(), sorteio });
  return sorteio;
}

export async function contestDraw(jogo: GameId, numero: number): Promise<Sorteio> {
  const key = `${jogo}:${numero}`;
  const cached = contestCache.get(key);
  if (cached) return cached;

  const sorteio = await fromSources(
    jogo,
    [
      () => pull(`https://api.guidi.dev.br/loteria/${jogo}/${numero}`),
      () => pull(`https://api.brasilapifacil.com.br/v1/loteria/${jogo}/${numero}`),
      () => pull(`https://raw.githubusercontent.com/maickon/free-apiloterias/refs/heads/master/database/${jogo}/${numero}.json`),
      () => pull(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}/${numero}`, CAIXA_HEADERS),
    ],
    numero,
  );
  contestCache.set(key, sorteio);
  return sorteio;
}

const recentCache = new Map<GameId, { at: number; numero: number; draws: Sorteio[] }>();

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function rememberContest(sorteio: Sorteio | null) {
  if (!sorteio) return;
  contestCache.set(`${sorteio.jogo}:${sorteio.numero}`, sorteio);
}

async function loadContest(jogo: GameId, numero: number, source: "caixa" | "guidi" | "github" | "brasil"): Promise<Sorteio | null> {
  const key = `${jogo}:${numero}`;
  const cached = contestCache.get(key);
  if (cached) return cached;
  const url =
    source === "guidi"
      ? `https://api.guidi.dev.br/loteria/${jogo}/${numero}`
      : source === "github"
        ? `https://raw.githubusercontent.com/maickon/free-apiloterias/master/database/${jogo}/${numero}.json`
        : source === "brasil"
          ? `https://api.brasilapifacil.com.br/v1/loteria/${jogo}/${numero}`
          : `https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}/${numero}`;
  try {
    const timeout = source === "caixa" ? 2500 : source === "brasil" ? 8000 : 4000;
    const sorteio = normalize(jogo, await pull(url, source === "caixa" ? CAIXA_HEADERS : undefined, timeout));
    if (!sorteio || sorteio.numero !== numero) return null;
    sorteio.jogo = jogo;
    contestCache.set(key, sorteio);
    return sorteio;
  } catch {
    return null;
  }
}

function mergeDraws(draws: Array<Sorteio | null>): Sorteio[] {
  const byNumero = new Map<number, Sorteio>();
  for (const draw of draws) {
    if (draw) byNumero.set(draw.numero, draw);
  }
  return [...byNumero.values()].sort((a, b) => b.numero - a.numero);
}

function coherentWindow(draws: Sorteio[], minimum: number): Sorteio[] {
  const groups: Sorteio[][] = [];
  let current: Sorteio[] = [];
  for (const draw of draws) {
    const prev = current[current.length - 1];
    if (prev && prev.numero - draw.numero > 3) {
      groups.push(current);
      current = [];
    }
    current.push(draw);
  }
  if (current.length) groups.push(current);
  const viable = groups.filter((group) => group.length >= minimum);
  const pool = viable.length ? viable : groups;
  pool.sort((a, b) => b[0].numero - a[0].numero || b.length - a.length);
  return pool[0] ?? [];
}

async function githubLatest(jogo: GameId): Promise<Sorteio | null> {
  try {
    const sorteio = normalize(
      jogo,
      await pull(`https://raw.githubusercontent.com/maickon/free-apiloterias/master/database/${jogo}/_ultimo.json`, undefined, 4000),
    );
    if (!sorteio) return null;
    sorteio.jogo = jogo;
    rememberContest(sorteio);
    return sorteio;
  } catch {
    return null;
  }
}

export async function recentDraws(jogo: GameId, take: number): Promise<Sorteio[]> {
  const latest = await latestDraw(jogo);
  const want = Math.max(1, Math.min(take, latest.numero));
  const goal = jogo === "supersete" ? Math.min(want, 6) : want;
  const minimum = Math.min(5, goal);
  const cached = recentCache.get(jogo);
  if (cached && Date.now() - cached.at < TTL_MS && cached.draws.length >= minimum && cached.numero >= latest.numero - 2) {
    return cached.draws.slice(0, goal);
  }

  const history = async (end: number, count: number, source: "caixa" | "guidi" | "github" | "brasil", limit: number) => {
    const start = Math.max(1, end - count + 1);
    const numeros: number[] = [];
    for (let numero = start; numero < end; numero++) numeros.push(numero);
    if (!numeros.length) return [];
    return mapPool(numeros, limit, (numero) => loadContest(jogo, numero, source));
  };

  let draws = mergeDraws([latest]);
  if (jogo === "supersete") {
    draws = mergeDraws([latest, ...(await history(latest.numero, goal, "guidi", 2))]);
  } else {
    draws = mergeDraws([latest, ...(await history(latest.numero, goal, "caixa", 4))]);
    if (draws.length < minimum) {
      draws = mergeDraws([...draws, ...(await history(latest.numero, goal, "guidi", 2))]);
    }
  }
  if (draws.length < minimum) {
    draws = mergeDraws([...draws, ...(await history(latest.numero, goal, "brasil", 4))]);
  }

  if (draws.length < minimum) {
    const mirror = await githubLatest(jogo);
    if (mirror && latest.numero - mirror.numero <= 3) {
      const end = mirror.numero;
      draws = mergeDraws([mirror, latest, ...draws, ...(await history(end, Math.min(12, end), "github", 6))]);
    }
  }

  const chosen = coherentWindow(draws, minimum);
  if (chosen.length < minimum) throw new Error("estatisticas_insuficientes");
  recentCache.set(jogo, { at: Date.now(), numero: chosen[0].numero, draws: chosen });
  return chosen.slice(0, goal);
}
