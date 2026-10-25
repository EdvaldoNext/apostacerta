import { conferir } from "./conferir";
import type { GameId } from "./games";
import type { BetView, Sorteio } from "./types";

export function rotuloFaixa(jogo: GameId): string {
  switch (jogo) {
    case "lotofacil":
      return "11 pontos ou mais";
    case "megasena":
      return "4 acertos ou mais";
    case "quina":
      return "2 acertos ou mais";
    case "lotomania":
      return "15 acertos ou mais, ou nenhum";
    case "duplasena":
      return "3 acertos ou mais em algum dos sorteios";
    case "timemania":
      return "3 acertos ou mais, ou o Time do Coração";
    case "diadesorte":
      return "4 acertos ou mais, ou o mês da sorte";
    case "supersete":
      return "3 colunas ou mais";
    case "maismilionaria":
      return "alguma faixa de premiação";
  }
}

export function medirApostas(jogo: GameId, bets: BetView[], draws: Sorteio[]): { janela: number; vezes: number[] } {
  const vezes = bets.map((bet) => draws.reduce((total, draw) => total + (conferir(jogo, bet, draw).premiada ? 1 : 0), 0));
  return { janela: draws.length, vezes };
}
