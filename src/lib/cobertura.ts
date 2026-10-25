import { combination, GAME_MAP } from "./games";

export interface CoberturaLotofacil {
  dezenas: number[];
  jogos: number[][];
  garantia: number;
  completos: number;
  total: number;
  totalCheio: number;
  frase: string;
}

/**
 * Jogos de 15 a partir de um grupo de 16 a 20.
 * Cada jogo deixa de fora um bloco do grupo. Se as 15 sorteadas estiverem
 * nesse grupo, algum jogo encontra o bloco deixado de fora do sorteio
 * e faz pelo menos `garantia` pontos.
 * 16 dezenas: 1 jogo, 14 pontos. 17: 8 jogos, 14. 18: 6 jogos, 13.
 * 19: 4 jogos, 12. 20: 4 jogos, 12.
 */
export function coberturaLotofacil(dezenas: number[]): CoberturaLotofacil | null {
  const pool = [...new Set(dezenas)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 25).sort((a, b) => a - b);
  const n = pool.length;
  if (n < 16 || n > 20) return null;

  const bloco = n - 15;
  const garantia = n === 16 ? 14 : n === 20 ? 12 : 31 - n;
  const jogos: number[][] = [];

  if (n === 16) {
    const fora = new Set([pool[0]]);
    jogos.push(pool.filter((item) => !fora.has(item)));
  } else {
    const cobertos = Math.floor(n / bloco) * bloco;
    for (let i = 0; i < cobertos; i += bloco) {
      const fora = new Set(pool.slice(i, i + bloco));
      const jogo = pool.filter((item) => !fora.has(item));
      if (jogo.length === 15) jogos.push(jogo);
    }
  }

  if (!jogos.length || jogos.some((jogo) => jogo.length !== 15)) return null;

  const preco = GAME_MAP.lotofacil.price;
  const completos = combination(n, 15);
  const total = Math.round(jogos.length * preco * 100) / 100;
  const totalCheio = Math.round(completos * preco * 100) / 100;
  return {
    dezenas: pool,
    jogos,
    garantia,
    completos,
    total,
    totalCheio,
    frase: `Se as 15 dezenas sorteadas estiverem entre as ${n} marcadas, algum destes jogos faz ${garantia} pontos ou mais.`,
  };
}
