import { JANELA_ESTATISTICA, perfilFromDraws, type PerfilEstatistico } from "@/lib/estatisticas";
import { quote, GAME_MAP, isGameId, TIMES } from "@/lib/games";
import { betsFromNumbers, generateBets, type GenerateInput } from "@/lib/generate";
import { isSubscriptionActive, subscriptionGuard } from "@/server/access";
import { db, nowIso, str, uuid } from "@/server/db";
import { asInt, asString, fail, json, readJson } from "@/server/http";
import { latestDraw, recentDraws } from "@/server/loterias";
import { requireSession } from "@/server/session";

function concursoDoPayload(payload: { concurso?: unknown }): number | null {
  return typeof payload.concurso === "number" && Number.isInteger(payload.concurso) && payload.concurso > 0
    ? payload.concurso
    : null;
}

function parseInput(body: Record<string, unknown>): GenerateInput | string {
  const jogo = asString(body.jogo);
  if (!isGameId(jogo)) return "Jogo desconhecido.";
  const game = GAME_MAP[jogo];
  const count = asInt(body.count) ?? 1;
  const pick = asInt(body.pick) ?? game.pickMin;
  const mode = body.mode === "surpresa" ? "surpresa" : "estatistico";
  const trevos = asInt(body.trevos) ?? 2;
  const mes = asInt(body.mes);
  const time = asString(body.time).trim();

  if (count < 1 || count > 10) return "Gere de 1 a 10 apostas.";
  if (pick < game.pickMin || pick > game.pickMax) return "Quantidade de dezenas fora da faixa deste jogo.";
  if (jogo === "maismilionaria" && (trevos < 2 || trevos > 6)) return "Escolha de 2 a 6 trevos.";
  if (mes !== null && (mes < 1 || mes > 12)) return "Mês inválido.";
  if (time && !TIMES.includes(time)) return "Time inválido.";

  const hotRaw = Array.isArray(body.hot) ? body.hot : [];
  const hot = hotRaw.map((n) => (typeof n === "number" ? n : Number(n))).filter((n) => Number.isInteger(n));
  if (hot.length > 10) return "No máximo 10 números favoritos.";
  if (new Set(hot).size !== hot.length) return "Há números favoritos repetidos.";
  if (hot.some((n) => n < game.min || n > game.max)) return "Favorito fora do volante.";
  if (jogo !== "supersete" && hot.length > pick) return "Favoritos demais para o tamanho da aposta.";

  const rawGap = asInt(body.gapMax);
  if (rawGap !== null && (rawGap < 2 || rawGap > 5)) return "Escolha um salto de 2 a 5.";

  return {
    jogo,
    count,
    pick: jogo === "supersete" ? 7 : pick,
    mode,
    hot: jogo === "supersete" ? [] : hot,
    trevos,
    mes,
    time: time || null,
    gapMax: jogo === "lotofacil" && pick === 15 && rawGap !== null ? rawGap : null,
  };
}

function parseFixas(body: Record<string, unknown>): number[][] | string | null {
  if (!Array.isArray(body.fixas)) return null;
  if (body.fixas.length < 1 || body.fixas.length > 10) return "Guarde de 1 a 10 jogos.";
  const lists: number[][] = [];
  for (const item of body.fixas) {
    if (!Array.isArray(item) || item.length !== 15) return "Cada jogo da cobertura tem 15 dezenas.";
    const numbers = item.map((n) => (typeof n === "number" ? n : Number(n)));
    if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 25)) return "Dezena fora do volante da Lotofácil.";
    if (new Set(numbers).size !== numbers.length) return "Há dezenas repetidas no jogo.";
    lists.push(numbers);
  }
  return lists;
}

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const guard = await subscriptionGuard(auth.user);
  if (guard) return guard;

  const result = await db().execute({
    sql: `SELECT id, jogo, quantidade, payload, created_at
          FROM apostas
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 30`,
    args: [auth.user.id],
  });

  const items = result.rows.map((row) => {
    const payload = JSON.parse(str(row, "payload")) as { bets: unknown; total: number; concurso?: unknown };
    return {
      id: str(row, "id"),
      jogo: str(row, "jogo"),
      quantidade: Number(row.quantidade),
      created_at: str(row, "created_at"),
      bets: payload.bets,
      total: payload.total,
      concurso: concursoDoPayload(payload),
    };
  });
  return json({ items });
}

async function proximoConcurso(jogo: GenerateInput["jogo"]): Promise<number | null> {
  try {
    const ultimo = await latestDraw(jogo);
    return ultimo.numero + 1;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");
  const active = await isSubscriptionActive(auth.user);
  const preview = body.preview === true;
  const fixas = parseFixas(body);

  if (!active) {
    if (fixas) return fail(402, "subscription_required", "A cobertura faz parte do plano.");
    if (!preview) return fail(402, "subscription_required", "Assine para gerar e guardar jogos.");
    if ((asInt(body.count) ?? 1) !== 1) return fail(400, "invalid_bet", "A amostra grátis gera 1 jogo.");
  }

  if (typeof fixas === "string") return fail(400, "invalid_bet", fixas);

  if (fixas && active) {
    const bets = betsFromNumbers("lotofacil", fixas);
    const total = Math.round(GAME_MAP.lotofacil.price * bets.length * 100) / 100;
    const id = uuid();
    const createdAt = nowIso();
    const concurso = await proximoConcurso("lotofacil");
    await db().execute({
      sql: `INSERT INTO apostas (id, user_id, jogo, quantidade, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        auth.user.id,
        "lotofacil",
        bets.length,
        JSON.stringify({ bets, total, pick: 15, mode: "cobertura", combos: 1, concurso }),
        createdAt,
      ],
    });
    return json({ id, jogo: "lotofacil", quantidade: bets.length, created_at: createdAt, bets, total, concurso });
  }

  const parsed = parseInput(body);
  if (typeof parsed === "string") return fail(400, "invalid_bet", parsed);
  if (preview && !active) parsed.count = 1;

  const game = GAME_MAP[parsed.jogo];
  const price = quote(game, parsed.pick, parsed.trevos);
  let perfil: PerfilEstatistico | null = null;
  if (parsed.mode === "estatistico") {
    try {
      perfil = perfilFromDraws(parsed.jogo, await recentDraws(parsed.jogo, JANELA_ESTATISTICA));
    } catch {
      perfil = null;
    }
  }
  const bets = generateBets({ ...parsed, perfil });
  const total = Math.round(price.total * parsed.count * 100) / 100;
  const id = uuid();
  const createdAt = nowIso();
  const concurso = await proximoConcurso(parsed.jogo);

  if (preview && !active) {
    const marked = await db().execute({
      sql: "UPDATE users SET preview_used = 1 WHERE id = ? AND preview_used = 0",
      args: [auth.user.id],
    });
    if (Number(marked.rowsAffected) !== 1) {
      return fail(402, "preview_used", "A amostra grátis já foi usada.");
    }
    return json({
      id,
      jogo: parsed.jogo,
      quantidade: 1,
      created_at: createdAt,
      bets,
      total,
      concurso,
      preview: true,
    });
  }

  await db().execute({
    sql: `INSERT INTO apostas (id, user_id, jogo, quantidade, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      auth.user.id,
      parsed.jogo,
      parsed.count,
      JSON.stringify({ bets, total, pick: parsed.pick, mode: parsed.mode, combos: price.combos, concurso, gapMax: parsed.gapMax ?? null }),
      createdAt,
    ],
  });

  return json({
    id,
    jogo: parsed.jogo,
    quantidade: parsed.count,
    created_at: createdAt,
    bets,
    total,
    concurso,
  });
}
