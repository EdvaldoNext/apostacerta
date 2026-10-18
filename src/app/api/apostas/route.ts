import { quote, GAME_MAP, isGameId, TIMES } from "@/lib/games";
import { generateBets, type GenerateInput } from "@/lib/generate";
import { subscriptionGuard } from "@/server/access";
import { db, nowIso, str, uuid } from "@/server/db";
import { asInt, asString, fail, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

function parseInput(body: Record<string, unknown>): GenerateInput | string {
  const jogo = asString(body.jogo);
  if (!isGameId(jogo)) return "Jogo desconhecido.";
  const game = GAME_MAP[jogo];
  const count = asInt(body.count) ?? 1;
  const pick = asInt(body.pick) ?? game.pickMin;
  const mode = body.mode === "surpresa" ? "surpresa" : "balanceado";
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

  return {
    jogo,
    count,
    pick: jogo === "supersete" ? 7 : pick,
    mode,
    hot: jogo === "supersete" ? [] : hot,
    trevos,
    mes,
    time: time || null,
  };
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
    const payload = JSON.parse(str(row, "payload")) as { bets: unknown; total: number };
    return {
      id: str(row, "id"),
      jogo: str(row, "jogo"),
      quantidade: Number(row.quantidade),
      created_at: str(row, "created_at"),
      bets: payload.bets,
      total: payload.total,
    };
  });
  return json({ items });
}

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const guard = await subscriptionGuard(auth.user);
  if (guard) return guard;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");
  const parsed = parseInput(body);
  if (typeof parsed === "string") return fail(400, "invalid_bet", parsed);

  const game = GAME_MAP[parsed.jogo];
  const price = quote(game, parsed.pick, parsed.trevos);
  const bets = generateBets(parsed);
  const total = Math.round(price.total * parsed.count * 100) / 100;
  const id = uuid();
  const createdAt = nowIso();

  await db().execute({
    sql: `INSERT INTO apostas (id, user_id, jogo, quantidade, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      auth.user.id,
      parsed.jogo,
      parsed.count,
      JSON.stringify({ bets, total, pick: parsed.pick, mode: parsed.mode, combos: price.combos }),
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
  });
}
