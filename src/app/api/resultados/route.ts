import { isGameId } from "@/lib/games";
import { asInt, fail, json } from "@/server/http";
import { contestDraw, latestDraw } from "@/server/loterias";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jogo = url.searchParams.get("jogo") || "";
  if (!isGameId(jogo)) return fail(400, "invalid_game", "Jogo desconhecido.");

  const concursoRaw = url.searchParams.get("concurso");
  if (concursoRaw) {
    const numero = asInt(concursoRaw);
    if (numero === null || numero < 1 || numero > 99999) {
      return fail(400, "invalid_contest", "Informe um número de concurso válido.");
    }
    try {
      const sorteio = await contestDraw(jogo, numero);
      return json({ sorteio });
    } catch (error) {
      if (error instanceof Error && error.message === "concurso_nao_encontrado") {
        return fail(404, "concurso_nao_encontrado", "Esse concurso não foi encontrado.");
      }
      return fail(502, "resultado_indisponivel", "Não foi possível consultar o resultado agora.");
    }
  }

  try {
    const sorteio = await latestDraw(jogo, url.searchParams.get("fresh") === "1");
    return json({ sorteio });
  } catch {
    return fail(502, "resultado_indisponivel", "Não foi possível consultar o resultado agora.");
  }
}
