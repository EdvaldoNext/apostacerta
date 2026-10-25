import { GAME_MAP, MESES, type GameId } from "./games";
import type { Sorteio } from "./types";

export const JANELA_ESTATISTICA = 20;

const PESO_FREQUENTE = 3;
const PESO_ATRASADA = 4;
const PESO_REPETIDA = 1;

export interface ColunaEstatistica {
  frequente: number;
  atrasado: number;
  repetido: number;
  pesos: number[];
}

export interface PerfilEstatistico {
  concurso: number;
  janela: number;
  frequentes: number[];
  atrasadas: number[];
  repetidas: number[];
  pesos: number[];
  colunas: ColunaEstatistica[] | null;
  trevosPesos: number[] | null;
  mesesPesos: number[] | null;
}

export interface ResumoEstatistica {
  concurso: number;
  janela: number;
  frequentes: number[];
  atrasadas: number[];
  repetidas: number[];
  colunas: Array<Pick<ColunaEstatistica, "frequente" | "atrasado" | "repetido">> | null;
  trevosFrequentes: number[];
  mesFrequente: string | null;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dedupe(draws: Sorteio[]): Sorteio[] {
  const ordered = [...draws].sort((a, b) => b.numero - a.numero);
  const unique: Sorteio[] = [];
  const seen = new Set<number>();
  for (const draw of ordered) {
    if (seen.has(draw.numero)) continue;
    seen.add(draw.numero);
    unique.push(draw);
  }
  return unique;
}

function listaTamanho(span: number): number {
  return span <= 31 ? 8 : 10;
}

function perfilSuperSete(unique: Sorteio[]): PerfilEstatistico {
  const colunas: ColunaEstatistica[] = [];
  for (let col = 0; col < 7; col++) {
    const freq = Array<number>(10).fill(0);
    const lastSeen = Array<number>(10).fill(unique.length);
    unique.forEach((draw, age) => {
      const digit = draw.dezenas[col];
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) return;
      freq[digit] += 1;
      if (lastSeen[digit] === unique.length) lastSeen[digit] = age;
    });
    let frequente = 0;
    let atrasado = 0;
    for (let digit = 1; digit < 10; digit++) {
      if (freq[digit] > freq[frequente]) frequente = digit;
      if (lastSeen[digit] > lastSeen[atrasado]) atrasado = digit;
    }
    const repetido = unique[0].dezenas[col] ?? 0;
    const pesos = Array<number>(10).fill(1);
    pesos[frequente] += PESO_FREQUENTE;
    if (atrasado !== frequente && lastSeen[atrasado] >= 1) pesos[atrasado] += PESO_ATRASADA;
    if (repetido !== frequente && repetido !== atrasado) pesos[repetido] += PESO_REPETIDA;
    colunas.push({ frequente, atrasado, repetido, pesos });
  }
  return {
    concurso: unique[0].numero,
    janela: unique.length,
    frequentes: [],
    atrasadas: [],
    repetidas: [],
    pesos: [],
    colunas,
    trevosPesos: null,
    mesesPesos: null,
  };
}

function trevosPesosDe(unique: Sorteio[]): number[] | null {
  const freq = Array<number>(7).fill(0);
  for (const draw of unique) {
    for (const trevo of draw.trevos) {
      if (trevo >= 1 && trevo <= 6) freq[trevo] += 1;
    }
  }
  if (freq.every((count) => count === 0)) return null;
  const pesos = [0, 1, 1, 1, 1, 1, 1];
  const ranked = [1, 2, 3, 4, 5, 6].sort((a, b) => freq[b] - freq[a] || a - b);
  if (freq[ranked[0]] > 0) pesos[ranked[0]] += PESO_FREQUENTE;
  if (freq[ranked[1]] > 0 && ranked[1] !== ranked[0]) pesos[ranked[1]] += PESO_ATRASADA;
  return pesos;
}

function mesesPesosDe(unique: Sorteio[]): number[] | null {
  const freq = Array<number>(12).fill(0);
  for (const draw of unique) {
    const nome = fold(draw.extra ?? "");
    const index = MESES.findIndex((mes) => fold(mes) === nome);
    if (index >= 0) freq[index] += 1;
  }
  if (freq.every((count) => count === 0)) return null;
  const pesos = Array<number>(12).fill(1);
  const ranked = freq
    .map((count, index) => ({ count, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
  for (const item of ranked.slice(0, 3)) {
    if (item.count > 0) pesos[item.index] += PESO_FREQUENTE;
  }
  return pesos;
}

export function perfilFromDraws(jogo: GameId, draws: Sorteio[]): PerfilEstatistico | null {
  const unique = dedupe(draws);
  if (!unique.length) return null;
  if (jogo === "supersete") return perfilSuperSete(unique);

  const game = GAME_MAP[jogo];
  const span = game.max - game.min + 1;
  const size = listaTamanho(span);
  const freq = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  for (let n = game.min; n <= game.max; n++) {
    freq.set(n, 0);
    lastSeen.set(n, unique.length);
  }

  unique.forEach((draw, age) => {
    const nums = new Set([...draw.dezenas, ...draw.dezenasSegundo]);
    for (const n of nums) {
      if (n < game.min || n > game.max) continue;
      freq.set(n, (freq.get(n) ?? 0) + 1);
      if (lastSeen.get(n) === unique.length) lastSeen.set(n, age);
    }
  });

  const frequentes = [...freq.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, size)
    .map(([n]) => n);
  const freqSet = new Set(frequentes);
  const atrasadas = [...lastSeen.entries()]
    .filter(([n, age]) => age >= 1 && !freqSet.has(n))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, size)
    .map(([n]) => n);
  const repetidas = [...new Set([...unique[0].dezenas, ...unique[0].dezenasSegundo])]
    .filter((n) => n >= game.min && n <= game.max)
    .sort((a, b) => a - b);

  const pesos = Array<number>(game.max + 1).fill(1);
  const atrasoSet = new Set(atrasadas);
  const repetidaSet = new Set(repetidas);
  for (let n = game.min; n <= game.max; n++) {
    let peso = 1;
    if (freqSet.has(n)) peso += PESO_FREQUENTE;
    if (atrasoSet.has(n)) peso += PESO_ATRASADA;
    if (repetidaSet.has(n)) peso += PESO_REPETIDA;
    pesos[n] = peso;
  }

  return {
    concurso: unique[0].numero,
    janela: unique.length,
    frequentes,
    atrasadas,
    repetidas,
    pesos,
    colunas: null,
    trevosPesos: jogo === "maismilionaria" ? trevosPesosDe(unique) : null,
    mesesPesos: jogo === "diadesorte" ? mesesPesosDe(unique) : null,
  };
}

export function resumoEstatistico(perfil: PerfilEstatistico): ResumoEstatistica {
  const trevosFrequentes = perfil.trevosPesos
    ? [1, 2, 3, 4, 5, 6]
        .filter((n) => (perfil.trevosPesos?.[n] ?? 0) > 1)
        .sort((a, b) => (perfil.trevosPesos?.[b] ?? 0) - (perfil.trevosPesos?.[a] ?? 0) || a - b)
    : [];
  let mesFrequente: string | null = null;
  if (perfil.mesesPesos) {
    let best = 0;
    for (let i = 1; i < perfil.mesesPesos.length; i++) {
      if (perfil.mesesPesos[i] > perfil.mesesPesos[best]) best = i;
    }
    if (perfil.mesesPesos[best] > 1) mesFrequente = MESES[best];
  }
  return {
    concurso: perfil.concurso,
    janela: perfil.janela,
    frequentes: perfil.frequentes,
    atrasadas: perfil.atrasadas,
    repetidas: perfil.repetidas,
    colunas: perfil.colunas
      ? perfil.colunas.map(({ frequente, atrasado, repetido }) => ({ frequente, atrasado, repetido }))
      : null,
    trevosFrequentes,
    mesFrequente,
  };
}
