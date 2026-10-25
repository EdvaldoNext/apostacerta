import { medirApostas, rotuloFaixa } from "@/lib/retro";
import { GAME_MAP, isGameId, MESES, TIMES } from "@/lib/games";
import type { BetView } from "@/lib/types";
import { isSubscriptionActive } from "@/server/access";
import { asInt, asString, fail, json, readJson } from "@/server/http";
import { recentDraws } from "@/server/loterias";
import { requireSession } from "@/server/session";

function asNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const numbers = value.map((item) => (typeof item === "number" ? item : Number(item)));
  if (numbers.some((n) => !Number.isInteger(n))) return null;
  return numbers;
}

function parseBets(jogo: keyof typeof GAME_MAP, value: unknown): BetView[] | string {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return "Informe de 1 a 10 jogos.";
  const game = GAME_MAP[jogo];
  const bets: BetView[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return "Jogo inválido.";
    const row = item as Record<string, unknown>;
    const numbers = asNumbers(row.numbers);
    if (!numbers) return "Dezenas inválidas.";
    if (jogo === "supersete") {
      if (numbers.length !== 7 || numbers.some((n) => n < 0 || n > 9)) return "Colunas inválidas.";
      bets.push({ numbers, columns: numbers, stats: { evens: 0, odds: 0, sum: 0 } });
      continue;
    }
    if (numbers.length < game.pickMin || numbers.length > game.pickMax) return "Quantidade de dezenas fora da faixa.";
    if (numbers.some((n) => n < game.min || n > game.max)) return "Dezena fora do volante.";
    if (new Set(numbers).size !== numbers.length) return "Há dezenas repetidas.";
    const bet: BetView = { numbers, stats: { evens: 0, odds: 0, sum: numbers.reduce((a, b) => a + b, 0) } };
    if (jogo === "maismilionaria") {
      const trevos = asNumbers(row.trevos) ?? [];
      if (trevos.length < 2 || trevos.length > 6 || trevos.some((n) => n < 1 || n > 6) || new Set(trevos).size !== trevos.length) {
        return "Trevos inválidos.";
      }
      bet.trevos = trevos;
    }
    if (jogo === "diadesorte" && typeof row.mes === "string" && (MESES as readonly string[]).includes(row.mes)) bet.mes = row.mes;
    if (jogo === "timemania" && typeof row.time === "string" && (TIMES as readonly string[]).includes(row.time)) bet.time = row.time;
    bets.push(bet);
  }
  return bets;
}

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const jogo = asString(body.jogo);
  if (!isGameId(jogo)) return fail(400, "invalid_game", "Jogo desconhecido.");
  const janelaPedida = asInt(body.janela) ?? 20;
  if (janelaPedida !== 20 && janelaPedida !== 100) {
    return fail(400, "invalid_window", "A janela é de 20 ou 100 concursos.");
  }
  if (janelaPedida === 100 && !(await isSubscriptionActive(auth.user))) {
    return fail(402, "subscription_required", "Os 100 concursos fazem parte do plano. A amostra usa os últimos 20.");
  }

  const bets = parseBets(jogo, body.bets);
  if (typeof bets === "string") return fail(400, "invalid_bet", bets);

  try {
    const draws = await recentDraws(jogo, janelaPedida);
    const medido = medirApostas(jogo, bets, draws);
    return json({ janela: medido.janela, rotulo: rotuloFaixa(jogo), vezes: medido.vezes });
  } catch {
    return fail(502, "retro_indisponivel", "Não foi possível medir os concursos anteriores agora.");
  }
}
