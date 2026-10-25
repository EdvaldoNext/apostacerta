import type { GameId } from "./games";
import type { BetView, Sorteio } from "./types";

export interface Conferencia {
  acertos: number;
  acertosSegundo: number | null;
  trevos: number | null;
  extra: boolean | null;
  premiada: boolean;
  aplicavel: boolean;
  resumo: string;
}

type ConferenciaAberta = Omit<Conferencia, "aplicavel">;

export type SituacaoAposta =
  | { tipo: "carregando" }
  | { tipo: "aguardando"; resumo: string }
  | { tipo: "indisponivel"; resumo: string }
  | { tipo: "conferida"; sorteio: Sorteio };

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split("/")[0]
    .replace(/[^a-z0-9]/g, "");
}

function countHits(bet: number[], drawn: number[]): number {
  const set = new Set(drawn);
  return new Set(bet.filter((n) => set.has(n))).size;
}

function faixaMilionaria(acertos: number, trevos: number): string | null {
  if (acertos === 6 && trevos === 2) return "6 acertos + 2 trevos";
  if (acertos === 6) return "6 acertos + 1 ou nenhum trevo";
  if (acertos === 5 && trevos === 2) return "5 acertos + 2 trevos";
  if (acertos === 5) return "5 acertos + 1 ou nenhum trevo";
  if (acertos === 4 && trevos === 2) return "4 acertos + 2 trevos";
  if (acertos === 4) return "4 acertos + 1 ou nenhum trevo";
  if (acertos === 3 && trevos === 2) return "3 acertos + 2 trevos";
  if (acertos === 3 && trevos === 1) return "3 acertos + 1 trevo";
  if (acertos === 2 && trevos === 2) return "2 acertos + 2 trevos";
  if (acertos === 2 && trevos === 1) return "2 acertos + 1 trevo";
  return null;
}

function extraIgual(bet: string | undefined, drawn: string | null): boolean | null {
  if (!bet || !drawn) return null;
  return fold(bet) === fold(drawn);
}

/** 20:00 em Brasília, horário usual dos sorteios da Caixa. */
export function instanteSorteio(dataApuracao: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataApuracao);
  if (!match) return null;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 0, 0);
}

export function apostaCabeNoConcurso(createdAt: string | undefined, dataApuracao: string): boolean {
  if (!createdAt) return true;
  const end = instanteSorteio(dataApuracao);
  const created = Date.parse(createdAt);
  if (end === null || Number.isNaN(created)) return true;
  return created <= end;
}

function fechar(check: ConferenciaAberta, createdAt: string | undefined, dataApuracao: string): Conferencia {
  if (!apostaCabeNoConcurso(createdAt, dataApuracao)) {
    return { ...check, premiada: false, aplicavel: false, resumo: "Aguardando o próximo sorteio" };
  }
  return {
    ...check,
    aplicavel: true,
    resumo: check.premiada ? check.resumo : `Não premiada · ${check.resumo}`,
  };
}

export function situacaoDaAposta(
  aposta: { created_at: string; concurso: number | null },
  ctx: {
    ultimo: Sorteio | null;
    anterior: Sorteio | null;
    anteriorEstado: "ocioso" | "pronto" | "erro" | "sem_anterior";
    especifico: Sorteio | null;
    especificoEstado: "ocioso" | "carregando" | "erro" | "pronto";
  },
): SituacaoAposta {
  const { created_at: createdAt, concurso } = aposta;
  const { ultimo, anterior, anteriorEstado, especifico, especificoEstado } = ctx;

  if (concurso) {
    if (!ultimo) return { tipo: "carregando" };
    if (ultimo.numero < concurso) return { tipo: "aguardando", resumo: `Aguardando o concurso ${concurso}` };
    if (ultimo.numero === concurso) return { tipo: "conferida", sorteio: ultimo };
    if (especifico) return { tipo: "conferida", sorteio: especifico };
    if (especificoEstado === "erro") {
      return { tipo: "indisponivel", resumo: `Não foi possível conferir o concurso ${concurso}` };
    }
    return { tipo: "carregando" };
  }

  if (!ultimo) return { tipo: "carregando" };
  if (!apostaCabeNoConcurso(createdAt, ultimo.dataApuracao)) {
    return { tipo: "aguardando", resumo: "Aguardando o próximo sorteio" };
  }
  if (anteriorEstado === "ocioso") return { tipo: "carregando" };
  if (anteriorEstado === "erro") return { tipo: "indisponivel", resumo: "Não foi possível conferir agora" };
  if (anterior && apostaCabeNoConcurso(createdAt, anterior.dataApuracao)) {
    return { tipo: "indisponivel", resumo: "O concurso desta aposta já passou" };
  }
  return { tipo: "conferida", sorteio: ultimo };
}

export function dezenaAcertou(jogo: GameId, value: number, index: number, sorteio: Sorteio): boolean {
  if (jogo === "supersete") return sorteio.dezenas[index] === value;
  if (jogo === "duplasena") return sorteio.dezenas.includes(value) || sorteio.dezenasSegundo.includes(value);
  return sorteio.dezenas.includes(value);
}

export function conferir(jogo: GameId, bet: BetView, sorteio: Sorteio, createdAt?: string): Conferencia {
  if (jogo === "supersete") {
    const columns = bet.columns ?? bet.numbers;
    const acertos = columns.reduce((total, digit, index) => total + (sorteio.dezenas[index] === digit ? 1 : 0), 0);
    const premiada = acertos >= 3;
    return fechar(
      {
        acertos,
        acertosSegundo: null,
        trevos: null,
        extra: null,
        premiada,
        resumo: premiada ? `Premiada · ${acertos} colunas` : `${acertos} colunas`,
      },
      createdAt,
      sorteio.dataApuracao,
    );
  }

  if (jogo === "duplasena") {
    const acertos = countHits(bet.numbers, sorteio.dezenas);
    const acertosSegundo = countHits(bet.numbers, sorteio.dezenasSegundo);
    const premiada = acertos >= 3 || acertosSegundo >= 3;
    return fechar(
      {
        acertos,
        acertosSegundo,
        trevos: null,
        extra: null,
        premiada,
        resumo: premiada ? `Premiada · 1º ${acertos} · 2º ${acertosSegundo}` : `1º ${acertos} · 2º ${acertosSegundo}`,
      },
      createdAt,
      sorteio.dataApuracao,
    );
  }

  if (jogo === "maismilionaria") {
    const acertos = countHits(bet.numbers, sorteio.dezenas);
    const trevos = countHits(bet.trevos ?? [], sorteio.trevos);
    const faixa = faixaMilionaria(acertos, trevos);
    return fechar(
      {
        acertos,
        acertosSegundo: null,
        trevos,
        extra: null,
        premiada: faixa !== null,
        resumo: faixa ? `Premiada · ${faixa}` : `${acertos} acertos + ${trevos} trevos`,
      },
      createdAt,
      sorteio.dataApuracao,
    );
  }

  const acertos = countHits(bet.numbers, sorteio.dezenas);
  const extra =
    jogo === "timemania" ? extraIgual(bet.time, sorteio.extra) : jogo === "diadesorte" ? extraIgual(bet.mes, sorteio.extra) : null;

  let premiada = false;
  if (jogo === "lotomania") premiada = acertos === 0 || acertos >= 15;
  else if (jogo === "lotofacil") premiada = acertos >= 11;
  else if (jogo === "quina") premiada = acertos >= 2;
  else if (jogo === "timemania") premiada = acertos >= 3 || extra === true;
  else if (jogo === "diadesorte") premiada = acertos >= 4 || extra === true;
  else premiada = acertos >= 4;

  const partes = [`${acertos} acertos`];
  if (extra && jogo === "timemania") partes.push("Time do Coração");
  if (extra && jogo === "diadesorte") partes.push("mês da sorte");

  return fechar(
    {
      acertos,
      acertosSegundo: null,
      trevos: null,
      extra,
      premiada,
      resumo: premiada ? `Premiada · ${partes.join(" · ")}` : partes.join(" · "),
    },
    createdAt,
    sorteio.dataApuracao,
  );
}
