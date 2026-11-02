import { JANELA_ESTATISTICA, perfilFromDraws, resumoEstatistico } from "@/lib/estatisticas";
import { isGameId } from "@/lib/games";
import { fail, json } from "@/server/http";
import { historyDebug, recentDraws } from "@/server/loterias";

export const maxDuration = 60;

export async function GET(req: Request) {
  const jogo = new URL(req.url).searchParams.get("jogo") || "";
  if (!isGameId(jogo)) return fail(400, "invalid_game", "Jogo desconhecido.");

  try {
    const perfil = perfilFromDraws(jogo, await recentDraws(jogo, JANELA_ESTATISTICA));
    if (!perfil) return fail(502, "estatisticas_indisponiveis", "Não foi possível calcular as estatísticas agora.");
    return json({ ...resumoEstatistico(perfil), detail: historyDebug() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "estatisticas_indisponiveis";
    console.error("[estatisticas]", jogo, detail);
    return json({ error: "estatisticas_indisponiveis", message: "Não foi possível calcular as estatísticas agora.", detail }, 502);
  }
}
