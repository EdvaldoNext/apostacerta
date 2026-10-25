import type { PerfilEstatistico } from "./estatisticas";
import { GAME_MAP, MESES, TIMES, type GameId } from "./games";
import type { BetStats } from "./types";

export interface GeneratedBet {
  numbers: number[];
  columns?: number[];
  trevos?: number[];
  mes?: string;
  time?: string;
  stats: BetStats;
}

export interface GenerateInput {
  jogo: GameId;
  count: number;
  pick: number;
  mode: "surpresa" | "estatistico";
  hot: number[];
  trevos: number;
  mes: number | null;
  time: string | null;
  gapMax?: number | null;
  perfil?: PerfilEstatistico | null;
}

const PRIMES_25 = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23]);

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sample(min: number, max: number, count: number, hot: number[]): number[] {
  const pins = [...new Set(hot.filter((n) => n >= min && n <= max))].slice(0, count);
  const rest: number[] = [];
  for (let n = min; n <= max; n++) {
    if (!pins.includes(n)) rest.push(n);
  }
  return [...pins, ...shuffle(rest).slice(0, count - pins.length)].sort((a, b) => a - b);
}

function statsOf(numbers: number[], withPrimes = false): BetStats {
  const evens = numbers.filter((n) => n % 2 === 0).length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const stats: BetStats = { evens, odds: numbers.length - evens, sum };
  if (withPrimes) stats.primes = numbers.filter((n) => PRIMES_25.has(n)).length;
  return stats;
}

function weightedPick(pesos: number[]): number {
  let total = 0;
  for (const peso of pesos) total += Math.max(0, peso);
  if (total <= 0) return Math.floor(Math.random() * pesos.length);
  let ticket = Math.random() * total;
  for (let i = 0; i < pesos.length; i++) {
    ticket -= Math.max(0, pesos[i]);
    if (ticket <= 0) return i;
  }
  return pesos.length - 1;
}

function weightedSample(min: number, max: number, count: number, hot: number[], pesos: number[]): number[] {
  const pinned = new Set(hot.filter((n) => n >= min && n <= max));
  const pins = [...pinned].slice(0, count);
  const bag: number[] = [];
  for (let n = min; n <= max; n++) {
    if (!pins.includes(n)) bag.push(n);
  }
  const picked = [...pins];
  while (picked.length < count && bag.length > 0) {
    let total = 0;
    for (const n of bag) total += pesos[n] ?? 1;
    let ticket = total > 0 ? Math.random() * total : 0;
    let index = bag.length - 1;
    for (let i = 0; i < bag.length; i++) {
      ticket -= pesos[bag[i]] ?? 1;
      if (ticket <= 0) {
        index = i;
        break;
      }
    }
    picked.push(bag[index]);
    bag.splice(index, 1);
  }
  return picked.sort((a, b) => a - b);
}

function lotofacilChain(hot: number[], pesos: number[] | null, relax: boolean, maxGap: number): number[] | null {
  const seq: number[] = [];
  const startMax = Math.min(Math.max(maxGap, 1), 5);
  let current = 1 + Math.floor(Math.random() * startMax);
  seq.push(current);

  for (let i = 1; i < 15; i++) {
    const valid: number[] = [];
    const maxValue = 25 - (14 - i);
    for (let step = 1; step <= maxGap; step++) {
      const next = current + step;
      if (next <= 25 && next <= maxValue) valid.push(step);
    }
    if (!valid.length) return null;

    const weighted: number[] = [];
    for (const step of valid) {
      const next = current + step;
      const favor = hot.includes(next) ? (relax ? 2 : 5) : 1;
      const stat = pesos ? Math.max(1, pesos[next] ?? 1) : 1;
      const weight = pesos ? favor * stat : favor;
      for (let w = 0; w < weight; w++) weighted.push(step);
    }
    current += weighted[Math.floor(Math.random() * weighted.length)];
    seq.push(current);
  }

  const even = seq.filter((n) => n % 2 === 0).length;
  if (!relax) {
    if (even !== 7 && even !== 8) return null;
  } else if (even < 6 || even > 9) return null;

  const primes = seq.filter((n) => PRIMES_25.has(n)).length;
  if (!relax) {
    if (primes < 6 || primes > 8) return null;
  } else if (primes < 4 || primes > 9) return null;

  const sum = seq.reduce((a, b) => a + b, 0);
  if (sum < 171 || sum > 220) return null;
  return seq;
}

function passesBalance(numbers: number[], jogo: GameId, relax: boolean): boolean {
  const game = GAME_MAP[jogo];
  const evens = numbers.filter((n) => n % 2 === 0).length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = numbers.length * ((game.min + game.max) / 2);
  const band = mean * (relax ? 0.5 : 0.28);
  if (Math.abs(sum - mean) > band) return false;

  const slack = relax ? 3 : jogo === "lotomania" ? 4 : 1;
  if (Math.abs(evens - numbers.length / 2) > slack) return false;

  if (!relax && game.max >= 50 && numbers.length <= 15) {
    const mid = (game.min + game.max) / 2;
    const low = numbers.filter((n) => n <= mid).length;
    if (low === 0 || low === numbers.length) return false;
  }

  if (jogo === "lotomania") {
    for (let block = 0; block < 10; block++) {
      const count = numbers.filter((n) => Math.floor(n / 10) === block).length;
      const min = relax ? 1 : 3;
      const max = relax ? 9 : 7;
      if (count < min || count > max) return false;
    }
  }

  return true;
}

function pesosDoPerfil(input: GenerateInput): number[] | null {
  if (input.mode !== "estatistico") return null;
  const pesos = input.perfil?.pesos;
  return pesos && pesos.length > 1 ? pesos : null;
}

function coverageScore(numbers: number[], perfil: PerfilEstatistico): number {
  const set = new Set(numbers);
  const got = (list: number[]) => list.filter((n) => set.has(n)).length;
  const frequentes = got(perfil.frequentes);
  const atrasadas = got(perfil.atrasadas);
  const repetidas = got(perfil.repetidas);
  const target = (count: number, share: number) => Math.min(count, Math.max(2, Math.round(numbers.length * share)));
  const part = (count: number, goal: number) => {
    let score = 0;
    for (let i = 1; i <= count; i++) score += i <= goal ? 3 : 1;
    return score;
  };
  return (
    1 +
    part(frequentes, target(perfil.frequentes.length, 0.4)) +
    part(atrasadas, target(perfil.atrasadas.length, 0.28)) +
    part(repetidas, target(perfil.repetidas.length, 0.5))
  );
}

function pickByCoverage(pool: number[][], perfil: PerfilEstatistico | null): number[] {
  if (!perfil) return pool[Math.floor(Math.random() * pool.length)];
  let total = 0;
  const scores = pool.map((nums) => {
    const score = coverageScore(nums, perfil);
    total += score;
    return score;
  });
  let ticket = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    ticket -= scores[i];
    if (ticket <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function drawNumbers(input: GenerateInput): number[] {
  const game = GAME_MAP[input.jogo];
  if (input.jogo === "supersete") {
    const colunas = input.mode === "estatistico" ? input.perfil?.colunas : null;
    if (!colunas) return Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
    return colunas.map((coluna) => weightedPick(coluna.pesos));
  }
  if (input.mode === "surpresa") return sample(game.min, game.max, input.pick, input.hot);

  const pesos = pesosDoPerfil(input);
  const perfil = input.mode === "estatistico" ? input.perfil ?? null : null;
  const pool: number[][] = [];
  const take = 16;

  const gap = input.gapMax;
  const usarGap = input.jogo === "lotofacil" && input.pick === 15 && !!gap && gap >= 2 && gap <= 5;
  if (usarGap) {
    for (let i = 0; i < 8000 && pool.length < take; i++) {
      const seq = lotofacilChain(input.hot, pesos, i > 6500, gap as number);
      if (seq) pool.push(seq);
    }
    if (pool.length) return pickByCoverage(pool, perfil);
    for (let i = 0; i < 2000; i++) {
      const seq = lotofacilChain(input.hot, pesos, true, gap as number);
      if (seq) return seq;
    }
  }

  if (!pool.length) {
    for (let i = 0; i < 3000 && pool.length < take; i++) {
      const nums = pesos
        ? weightedSample(game.min, game.max, input.pick, input.hot, pesos)
        : sample(game.min, game.max, input.pick, input.hot);
      if (passesBalance(nums, input.jogo, i > 2500)) pool.push(nums);
    }
  }

  if (!pool.length) {
    return pesos
      ? weightedSample(game.min, game.max, input.pick, input.hot, pesos)
      : sample(game.min, game.max, input.pick, input.hot);
  }
  return pickByCoverage(pool, perfil);
}

function drawTrevos(count: number, pesos: number[] | null): number[] {
  if (!pesos) return shuffle([1, 2, 3, 4, 5, 6]).slice(0, count).sort((a, b) => a - b);
  return weightedSample(1, 6, count, [], pesos);
}

function describeStats(numbers: number[], input: GenerateInput): BetStats {
  const stats = statsOf(numbers, input.jogo === "lotofacil");
  const perfil = input.mode === "estatistico" ? input.perfil : null;
  if (!perfil) return stats;
  if (input.jogo === "supersete" && perfil.colunas) {
    let frequentes = 0;
    let atrasadas = 0;
    let repetidas = 0;
    numbers.forEach((digit, index) => {
      const coluna = perfil.colunas?.[index];
      if (!coluna) return;
      if (digit === coluna.frequente) frequentes += 1;
      if (digit === coluna.atrasado) atrasadas += 1;
      if (digit === coluna.repetido) repetidas += 1;
    });
    return { ...stats, frequentes, atrasadas, repetidas, concursoBase: perfil.concurso };
  }
  const escolhidos = new Set(numbers);
  return {
    ...stats,
    frequentes: perfil.frequentes.filter((n) => escolhidos.has(n)).length,
    atrasadas: perfil.atrasadas.filter((n) => escolhidos.has(n)).length,
    repetidas: perfil.repetidas.filter((n) => escolhidos.has(n)).length,
    concursoBase: perfil.concurso,
  };
}

export function betsFromNumbers(jogo: GameId, lists: number[][]): GeneratedBet[] {
  return lists.map((numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    return { numbers: sorted, stats: statsOf(sorted, jogo === "lotofacil") };
  });
}

export function generateBets(input: GenerateInput): GeneratedBet[] {
  const bets: GeneratedBet[] = [];
  for (let i = 0; i < input.count; i++) {
    const numbers = drawNumbers(input);
    const bet: GeneratedBet = {
      numbers,
      stats: describeStats(numbers, input),
    };
    if (input.jogo === "supersete") bet.columns = numbers;
    if (input.jogo === "maismilionaria") {
      const trevosPesos = input.mode === "estatistico" ? input.perfil?.trevosPesos ?? null : null;
      bet.trevos = drawTrevos(input.trevos, trevosPesos);
    }
    if (input.jogo === "diadesorte") {
      if (input.mes && input.mes >= 1 && input.mes <= 12) bet.mes = MESES[input.mes - 1];
      else if (input.mode === "estatistico" && input.perfil?.mesesPesos) bet.mes = MESES[weightedPick(input.perfil.mesesPesos)];
      else bet.mes = MESES[Math.floor(Math.random() * 12)];
    }
    if (input.jogo === "timemania") {
      bet.time = input.time && TIMES.includes(input.time) ? input.time : TIMES[Math.floor(Math.random() * TIMES.length)];
    }
    bets.push(bet);
  }
  return bets;
}
