import { GAME_MAP, MESES, TIMES, type GameId } from "./games";

export interface GeneratedBet {
  numbers: number[];
  columns?: number[];
  trevos?: number[];
  mes?: string;
  time?: string;
  stats: { evens: number; odds: number; sum: number; primes?: number };
}

export interface GenerateInput {
  jogo: GameId;
  count: number;
  pick: number;
  mode: "surpresa" | "balanceado";
  hot: number[];
  trevos: number;
  mes: number | null;
  time: string | null;
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

function statsOf(numbers: number[], withPrimes = false): GeneratedBet["stats"] {
  const evens = numbers.filter((n) => n % 2 === 0).length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const stats: GeneratedBet["stats"] = { evens, odds: numbers.length - evens, sum };
  if (withPrimes) stats.primes = numbers.filter((n) => PRIMES_25.has(n)).length;
  return stats;
}

function lotofacilChain(hot: number[], relax: boolean): number[] | null {
  const seq: number[] = [];
  let current = [1, 2, 3][Math.floor(Math.random() * 3)];
  seq.push(current);

  for (let i = 1; i < 15; i++) {
    const valid: number[] = [];
    for (let step = 1; step <= 3; step++) {
      const next = current + step;
      if (next <= 25 && next <= 10 + (i + 1)) valid.push(step);
    }
    if (!valid.length) return null;

    const weighted: number[] = [];
    for (const step of valid) {
      const next = current + step;
      const weight = hot.includes(next) ? (relax ? 2 : 5) : 1;
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

function drawNumbers(input: GenerateInput): number[] {
  const game = GAME_MAP[input.jogo];
  if (input.jogo === "supersete") {
    return Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
  }
  if (input.mode === "surpresa") return sample(game.min, game.max, input.pick, input.hot);

  if (input.jogo === "lotofacil" && input.pick === 15) {
    for (let i = 0; i < 8000; i++) {
      const seq = lotofacilChain(input.hot, i > 6500);
      if (seq) return seq;
    }
  }

  for (let i = 0; i < 3000; i++) {
    const nums = sample(game.min, game.max, input.pick, input.hot);
    if (passesBalance(nums, input.jogo, i > 2500)) return nums;
  }
  return sample(game.min, game.max, input.pick, input.hot);
}

function drawTrevos(count: number): number[] {
  return shuffle([1, 2, 3, 4, 5, 6]).slice(0, count).sort((a, b) => a - b);
}

export function generateBets(input: GenerateInput): GeneratedBet[] {
  const bets: GeneratedBet[] = [];
  for (let i = 0; i < input.count; i++) {
    const numbers = drawNumbers(input);
    const bet: GeneratedBet = {
      numbers,
      stats: statsOf(numbers, input.jogo === "lotofacil"),
    };
    if (input.jogo === "supersete") bet.columns = numbers;
    if (input.jogo === "maismilionaria") bet.trevos = drawTrevos(input.trevos);
    if (input.jogo === "diadesorte") {
      const index = input.mes && input.mes >= 1 && input.mes <= 12 ? input.mes - 1 : Math.floor(Math.random() * 12);
      bet.mes = MESES[index];
    }
    if (input.jogo === "timemania") {
      bet.time = input.time && TIMES.includes(input.time) ? input.time : TIMES[Math.floor(Math.random() * TIMES.length)];
    }
    bets.push(bet);
  }
  return bets;
}
