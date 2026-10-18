export type GameId =
  | "megasena"
  | "lotofacil"
  | "quina"
  | "lotomania"
  | "duplasena"
  | "timemania"
  | "diadesorte"
  | "supersete"
  | "maismilionaria";

export interface GameDef {
  id: GameId;
  name: string;
  blurb: string;
  schedule: string;
  accent: string;
  min: number;
  max: number;
  pickMin: number;
  pickMax: number;
  price: number;
  pad: number;
}

export const GAMES: GameDef[] = [
  {
    id: "megasena",
    name: "Mega-Sena",
    blurb: "6 a 20 dezenas entre 1 e 60.",
    schedule: "Ter, qui e domingo",
    accent: "#209869",
    min: 1,
    max: 60,
    pickMin: 6,
    pickMax: 20,
    price: 6,
    pad: 2,
  },
  {
    id: "lotofacil",
    name: "Lotofácil",
    blurb: "15 a 20 dezenas entre 1 e 25.",
    schedule: "Seg a sex e domingo",
    accent: "#930089",
    min: 1,
    max: 25,
    pickMin: 15,
    pickMax: 20,
    price: 3.5,
    pad: 2,
  },
  {
    id: "quina",
    name: "Quina",
    blurb: "5 a 15 dezenas entre 1 e 80.",
    schedule: "Seg a sex e domingo",
    accent: "#4c1d95",
    min: 1,
    max: 80,
    pickMin: 5,
    pickMax: 15,
    price: 3,
    pad: 2,
  },
  {
    id: "lotomania",
    name: "Lotomania",
    blurb: "50 dezenas fixas, de 00 a 99.",
    schedule: "Seg, qua e sex",
    accent: "#f78100",
    min: 0,
    max: 99,
    pickMin: 50,
    pickMax: 50,
    price: 3,
    pad: 2,
  },
  {
    id: "duplasena",
    name: "Dupla Sena",
    blurb: "6 a 15 dezenas. A mesma aposta vale nos dois sorteios.",
    schedule: "Seg, qua e sex",
    accent: "#a61324",
    min: 1,
    max: 50,
    pickMin: 6,
    pickMax: 15,
    price: 3,
    pad: 2,
  },
  {
    id: "timemania",
    name: "Timemania",
    blurb: "10 a 15 dezenas e um Time do Coração.",
    schedule: "Ter, qui e domingo",
    accent: "#d4a017",
    min: 1,
    max: 80,
    pickMin: 10,
    pickMax: 15,
    price: 3.5,
    pad: 2,
  },
  {
    id: "diadesorte",
    name: "Dia de Sorte",
    blurb: "7 a 15 dezenas e um mês da sorte.",
    schedule: "Seg a sex e domingo",
    accent: "#cb852b",
    min: 1,
    max: 31,
    pickMin: 7,
    pickMax: 15,
    price: 2.5,
    pad: 2,
  },
  {
    id: "supersete",
    name: "Super Sete",
    blurb: "Um dígito de 0 a 9 em cada uma das 7 colunas.",
    schedule: "Seg, qua e sex",
    accent: "#7da33a",
    min: 0,
    max: 9,
    pickMin: 7,
    pickMax: 7,
    price: 3,
    pad: 1,
  },
  {
    id: "maismilionaria",
    name: "+Milionária",
    blurb: "6 a 12 dezenas e de 2 a 6 trevos.",
    schedule: "Qua e domingo",
    accent: "#2e3078",
    min: 1,
    max: 50,
    pickMin: 6,
    pickMax: 12,
    price: 6,
    pad: 2,
  },
];

export const GAME_MAP: Record<GameId, GameDef> = Object.fromEntries(GAMES.map((g) => [g.id, g])) as Record<GameId, GameDef>;

export function isGameId(value: string): value is GameId {
  return value in GAME_MAP;
}

export const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const TIMES = [
  "Flamengo",
  "Vasco",
  "Fluminense",
  "Botafogo",
  "Palmeiras",
  "Corinthians",
  "São Paulo",
  "Santos",
  "Grêmio",
  "Internacional",
  "Cruzeiro",
  "Atlético-MG",
  "Bahia",
  "Vitória",
  "Sport",
  "Náutico",
  "Santa Cruz",
  "Ceará",
  "Fortaleza",
  "Athletico-PR",
  "Coritiba",
  "Goiás",
  "Atlético-GO",
  "Cuiabá",
  "América-MG",
  "Bragantino",
  "Ponte Preta",
  "Guarani",
  "Paysandu",
  "Remo",
  "Criciúma",
  "Juventude",
  "Chapecoense",
  "Avaí",
  "Figueirense",
  "CSA",
  "CRB",
  "ABC",
  "Operário-PR",
  "Botafogo-SP",
];

export function combination(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) result = (result * (n - kk + i)) / i;
  return Math.round(result);
}

export function quote(game: GameDef, pick: number, trevos = 2): { combos: number; total: number } {
  if (game.id === "lotomania" || game.id === "supersete") {
    return { combos: 1, total: game.price };
  }
  let combos = combination(pick, game.pickMin);
  if (game.id === "maismilionaria") combos *= combination(trevos, 2);
  return { combos, total: Math.round(combos * game.price * 100) / 100 };
}

export function padNumber(n: number, pad = 2): string {
  return String(n).padStart(pad, "0");
}
