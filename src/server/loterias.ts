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

function normalize(jogo: GameId, body: unknown): Sorteio | null {
  const row = asRecord(body);
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

async function pull(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
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
    () => pull(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}`, CAIXA_HEADERS),
    () => pull(`https://api.guidi.dev.br/loteria/${jogo}/ultimo`),
    () => pull(`https://raw.githubusercontent.com/maickon/free-apiloterias/refs/heads/master/database/${jogo}/_ultimo.json`),
  ];
  const found = await Promise.all(sources.map((source) => source().then((body) => normalize(jogo, body)).catch(() => null)));
  const draws = found.filter((item): item is Sorteio => item !== null).sort((a, b) => b.numero - a.numero);
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

async function loadContest(jogo: GameId, numero: number, source: "caixa" | "guidi"): Promise<Sorteio | null> {
  const key = `${jogo}:${numero}`;
  const cached = contestCache.get(key);
  if (cached) return cached;
  const url =
    source === "guidi"
      ? `https://api.guidi.dev.br/loteria/${jogo}/${numero}`
      : `https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}/${numero}`;
  try {
    const sorteio = normalize(jogo, await pull(url, source === "caixa" ? CAIXA_HEADERS : undefined));
    if (!sorteio || sorteio.numero !== numero) return null;
    contestCache.set(key, sorteio);
    return sorteio;
  } catch {
    return null;
  }
}

export async function recentDraws(jogo: GameId, take: number): Promise<Sorteio[]> {
  const latest = await latestDraw(jogo);
  const want = Math.max(1, Math.min(take, latest.numero));
  const goal = jogo === "supersete" ? Math.min(want, 6) : want;
  const cached = recentCache.get(jogo);
  if (cached && cached.numero === latest.numero && cached.draws.length >= Math.min(5, goal) && Date.now() - cached.at < TTL_MS) {
    return cached.draws.slice(0, goal);
  }

  const start = latest.numero - goal + 1;
  const byNumero = new Map<number, Sorteio>();
  byNumero.set(latest.numero, latest);

  const missing = () => {
    const numeros: number[] = [];
    for (let numero = start; numero < latest.numero; numero++) {
      if (!byNumero.has(numero)) numeros.push(numero);
    }
    return numeros;
  };

  const pullMissing = async (source: "caixa" | "guidi", limit: number, cap = Number.POSITIVE_INFINITY) => {
    const numeros = missing().slice(0, cap);
    if (!numeros.length) return;
    const fetched = await mapPool(numeros, limit, (numero) => loadContest(jogo, numero, source));
    for (const item of fetched) {
      if (item) byNumero.set(item.numero, item);
    }
  };

  if (jogo === "supersete") {
    await pullMissing("guidi", 2, 5);
  } else {
    await pullMissing("caixa", 4);
    if (missing().length) await pullMissing("guidi", 2, 6);
  }

  const draws = [...byNumero.values()].sort((a, b) => b.numero - a.numero);
  if (draws.length < Math.min(5, goal)) throw new Error("estatisticas_insuficientes");
  recentCache.set(jogo, { at: Date.now(), numero: latest.numero, draws });
  return draws.slice(0, goal);
}
