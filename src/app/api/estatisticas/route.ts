import { JANELA_ESTATISTICA, perfilFromDraws, resumoEstatistico } from "@/lib/estatisticas";
import { isGameId } from "@/lib/games";
import { fail, json } from "@/server/http";
import { recentDraws } from "@/server/loterias";

export const maxDuration = 60;

export async function GET(req: Request) {
  const jogo = new URL(req.url).searchParams.get("jogo") || "";
  if (!isGameId(jogo)) return fail(400, "invalid_game", "Jogo desconhecido.");

  try {
    const perfil = perfilFromDraws(jogo, await recentDraws(jogo, JANELA_ESTATISTICA));
    if (!perfil) return fail(502, "estatisticas_indisponiveis", "Não foi possível calcular as estatísticas agora.");
    return json(resumoEstatistico(perfil));
  } catch {
    return fail(502, "estatisticas_indisponiveis", "Não foi possível calcular as estatísticas agora.");
  }
}
