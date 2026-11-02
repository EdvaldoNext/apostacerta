import { GAME_MAP, type GameId } from "@/lib/games";
import type { Sorteio } from "@/lib/types";

const TTL_MS = 10 * 60 * 1000;
const LATEST_TIMEOUT_MS = 2500;
const LATEST_GRACE_MS = 300;
const HISTORY_CONCURRENCY = 6;

const cache = new Map<GameId, { at: number; sorteio: Sorteio }>();

const CAIXA_BROWSER = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

const CAIXA_ATTEMPTS: Array<Record<string, string> | undefined> = [
  undefined,
  CAIXA_BROWSER,
  { ...CAIXA_BROWSER, Referer: "https://loterias.caixa.gov.br/" },
];

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

function linkSignals(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!parent) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, parent]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted || timeout.aborted) {
    controller.abort();
    return controller.signal;
  }
  parent.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function pull(url: string, headers?: Record<string, string>, timeoutMs = 12000, parent?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    signal: linkSignals(timeoutMs, parent),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function pullCaixa(
  url: string,
  timeoutMs = 5000,
  parent?: AbortSignal,
  attempts: Array<Record<string, string> | undefined> = CAIXA_ATTEMPTS,
): Promise<unknown> {
  let lastError: unknown;
  for (const headers of attempts) {
    if (parent?.aborted) break;
    try {
      return await pull(url, headers, timeoutMs, parent);
    } catch (error) {
      lastError = error;
      console.error("[loterias] caixa", url, error instanceof Error ? error.message : error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("caixa_indisponivel");
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

async function pullCurrent(
  jogo: GameId,
  url: string,
  source: "caixa" | "plain",
  timeoutMs = 5000,
  caixaAttempts?: Array<Record<string, string> | undefined>,
): Promise<{ sorteio: Sorteio | null; note: string }> {
  try {
    const body =
      source === "caixa"
        ? await pullCaixa(url, timeoutMs, undefined, caixaAttempts)
        : await pull(url, undefined, timeoutMs);
    const sorteio = normalize(jogo, body);
    if (!sorteio || !isCurrentDraw(sorteio)) {
      const note = `${source}:${sorteio ? `antigo ${sorteio.numero} ${sorteio.dataApuracao}` : "payload"}`;
      console.error("[loterias] ignorado", jogo, note);
      return { sorteio: null, note };
    }
    sorteio.jogo = jogo;
    return { sorteio, note: "" };
  } catch (error) {
    const note = `${source}:${error instanceof Error ? error.message : "falha"}`;
    console.error("[loterias] fonte", note, url);
    return { sorteio: null, note };
  }
}

function raceLatest(
  tasks: Array<Promise<{ sorteio: Sorteio | null; note: string }>>,
): Promise<{ sorteio: Sorteio | null; notes: string[] }> {
  const notes: string[] = [];
  const draws: Sorteio[] = [];
  let remaining = tasks.length;
  let settled = false;
  let grace: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      if (grace) clearTimeout(grace);
      draws.sort((a, b) => b.numero - a.numero);
      resolve({ sorteio: draws[0] ?? null, notes });
    };

    if (!tasks.length) {
      finish();
      return;
    }

    for (const task of tasks) {
      task
        .then((item) => {
          if (item.note) notes.push(item.note);
          if (item.sorteio) draws.push(item.sorteio);
        })
        .catch((error) => {
          notes.push(error instanceof Error ? error.message : "falha");
        })
        .finally(() => {
          remaining -= 1;
          if (settled) return;
          if (draws.length && remaining > 0) {
            if (!grace) grace = setTimeout(finish, LATEST_GRACE_MS);
            return;
          }
          if (remaining === 0 || draws.length) finish();
        });
    }
  });
}

export async function latestDraw(jogo: GameId, fresh = false): Promise<Sorteio> {
  const cached = cache.get(jogo);
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.sorteio;

  const { sorteio: found, notes } = await raceLatest([
    pullCurrent(
      jogo,
      `https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}`,
      "caixa",
      LATEST_TIMEOUT_MS,
      [CAIXA_BROWSER],
    ),
    pullCurrent(jogo, `https://api.guidi.dev.br/loteria/${jogo}/ultimo`, "plain", LATEST_TIMEOUT_MS),
  ]);
  if (found) {
    cache.set(jogo, { at: Date.now(), sorteio: found });
    rememberContest(found);
    return found;
  }
  if (cached) return cached.sorteio;
  const note = notes.filter(Boolean).join(" | ");
  console.error("[loterias] latest", jogo, note);
  throw new Error(note || "resultado_indisponivel");
}

export async function contestDraw(jogo: GameId, numero: number): Promise<Sorteio> {
  const key = `${jogo}:${numero}`;
  const cached = contestCache.get(key);
  if (cached) return cached;

  const sorteio = await fromSources(
    jogo,
    [
      () => pull(`https://api.guidi.dev.br/loteria/${jogo}/${numero}`, undefined, 5000),
      () => pullCaixa(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}/${numero}`, 5000),
      () => pull(`https://raw.githubusercontent.com/maickon/free-apiloterias/master/database/${jogo}/${numero}.json`, undefined, 4000),
    ],
    numero,
  );
  contestCache.set(key, sorteio);
  return sorteio;
}

const recentCache = new Map<GameId, { at: number; numero: number; draws: Sorteio[] }>();

function rememberContest(sorteio: Sorteio | null) {
  if (!sorteio) return;
  contestCache.set(`${sorteio.jogo}:${sorteio.numero}`, sorteio);
}

async function loadContest(
  jogo: GameId,
  numero: number,
  source: "caixa" | "guidi" | "github",
  parent?: AbortSignal,
): Promise<Sorteio | null> {
  if (parent?.aborted) return null;
  const key = `${jogo}:${numero}`;
  const cached = contestCache.get(key);
  if (cached) return cached;
  const url =
    source === "guidi"
      ? `https://api.guidi.dev.br/loteria/${jogo}/${numero}`
      : source === "github"
        ? `https://raw.githubusercontent.com/maickon/free-apiloterias/master/database/${jogo}/${numero}.json`
        : `https://servicebus2.caixa.gov.br/portaldeloterias/api/${jogo}/${numero}`;
  const timeout = source === "github" ? 4000 : source === "caixa" ? LATEST_TIMEOUT_MS : 5000;
  try {
    const body =
      source === "caixa"
        ? await pullCaixa(url, timeout, parent, [CAIXA_BROWSER])
        : await pull(url, undefined, timeout, parent);
    const sorteio = normalize(jogo, body);
    if (!sorteio || sorteio.numero !== numero) return null;
    sorteio.jogo = jogo;
    contestCache.set(key, sorteio);
    return sorteio;
  } catch (error) {
    const retry = source === "guidi" && error instanceof Error && error.message === "429" && !parent?.aborted;
    if (!retry) return null;
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (parent?.aborted) return null;
    try {
      const sorteio = normalize(jogo, await pull(url, undefined, timeout, parent));
      if (!sorteio || sorteio.numero !== numero) return null;
      sorteio.jogo = jogo;
      contestCache.set(key, sorteio);
      return sorteio;
    } catch {
      return null;
    }
  }
}

async function loadContestLive(jogo: GameId, numero: number, parent?: AbortSignal): Promise<Sorteio | null> {
  const cached = contestCache.get(`${jogo}:${numero}`);
  if (cached) return cached;
  return loadContest(jogo, numero, "guidi", parent);
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

const HISTORY_BUDGET_MS = 20000;

async function collectParallel(
  numeros: number[],
  parent: AbortSignal,
  load: (numero: number) => Promise<Sorteio | null>,
): Promise<Sorteio[]> {
  const found: Sorteio[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(HISTORY_CONCURRENCY, numeros.length) }, async () => {
    while (!parent.aborted) {
      const index = cursor++;
      if (index >= numeros.length) return;
      const draw = await load(numeros[index]);
      if (draw) found.push(draw);
    }
  });
  await Promise.all(workers);
  return found;
}

async function collectHistory(
  jogo: GameId,
  end: number,
  count: number,
  source: "live" | "github" | "caixa",
  skip: Set<number> = new Set(),
): Promise<Sorteio[]> {
  const start = Math.max(1, end - count + 1);
  const numeros: number[] = [];
  for (let numero = end - 1; numero >= start; numero--) {
    if (!skip.has(numero)) numeros.push(numero);
  }
  if (!numeros.length) return [];

  const parent = AbortSignal.timeout(HISTORY_BUDGET_MS);
  if (source === "github" || source === "caixa") {
    return collectParallel(numeros, parent, (numero) => loadContest(jogo, numero, source, parent));
  }

  const found: Sorteio[] = [];
  for (const numero of numeros) {
    if (parent.aborted) break;
    const draw = await loadContestLive(jogo, numero, parent);
    if (draw) found.push(draw);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return found;
}

export async function recentDraws(jogo: GameId, take: number): Promise<Sorteio[]> {
  const latest = await latestDraw(jogo);
  const want = Math.max(1, Math.min(take, latest.numero));
  const goal = jogo === "supersete" ? Math.min(want, 6) : want;
  const minimum = Math.min(5, goal);
  const cached = recentCache.get(jogo);
  const cachedDraws =
    cached && Date.now() - cached.at < TTL_MS && cached.numero >= latest.numero - 2 ? cached.draws : [];
  if (cachedDraws.length >= goal) return cachedDraws.slice(0, goal);

  const skip = new Set(cachedDraws.map((draw) => draw.numero));
  let draws = mergeDraws([
    latest,
    ...cachedDraws,
    ...(await collectHistory(jogo, latest.numero, goal, "caixa", skip)),
  ]);
  if (coherentWindow(draws, minimum).length < goal) {
    const have = new Set(draws.map((draw) => draw.numero));
    draws = mergeDraws([...draws, ...(await collectHistory(jogo, latest.numero, goal, "live", have))]);
  }
  if (draws.length < minimum) {
    const mirror = await githubLatest(jogo);
    if (mirror && latest.numero - mirror.numero <= 3) {
      const have = new Set(draws.map((draw) => draw.numero));
      draws = mergeDraws([
        mirror,
        ...draws,
        ...(await collectHistory(jogo, mirror.numero, Math.min(12, mirror.numero), "github", have)),
      ]);
    }
  }

  const chosen = coherentWindow(draws, minimum);
  if (!chosen.length) {
    console.error("[loterias] historico", jogo, "sem concursos");
    throw new Error("estatisticas_insuficientes");
  }
  recentCache.set(jogo, { at: Date.now(), numero: chosen[0].numero, draws: chosen });
  return chosen.slice(0, goal);
}
