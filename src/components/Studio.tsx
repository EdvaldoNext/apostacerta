"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { coberturaLotofacil, type CoberturaLotofacil } from "@/lib/cobertura";
import { conferir, dezenaAcertou, situacaoDaAposta, type SituacaoAposta } from "@/lib/conferir";
import type { ResumoEstatistica } from "@/lib/estatisticas";
import { formatBRL, formatTimestampBR } from "@/lib/format";
import { GAMES, GAME_MAP, MESES, TIMES, isGameId, padNumber, quote, type GameId } from "@/lib/games";
import type { BetView, SavedBet, Sorteio } from "@/lib/types";

function resolverSituacao(
  item: { jogo: string; created_at: string; concurso: number | null },
  sorteios: Partial<Record<GameId, Sorteio>>,
  anteriores: Partial<Record<GameId, Sorteio>>,
  anteriorEstado: Partial<Record<GameId, "pronto" | "erro">>,
  especificos: Record<string, Sorteio>,
  especificoEstado: Record<string, "error" | "ready">,
): SituacaoAposta {
  if (!isGameId(item.jogo)) return { tipo: "indisponivel", resumo: "Jogo desconhecido" };
  const ultimo = sorteios[item.jogo] ?? null;
  const anteriorEstadoItem =
    !ultimo || ultimo.numero < 2 ? "sem_anterior" : (anteriorEstado[item.jogo] ?? "ocioso");
  const key = item.concurso ? `${item.jogo}:${item.concurso}` : "";
  const especifico = key ? (especificos[key] ?? null) : null;
  let especificoEstadoItem: "ocioso" | "carregando" | "erro" | "pronto" = "ocioso";
  if (item.concurso && ultimo && item.concurso < ultimo.numero) {
    if (especifico) especificoEstadoItem = "pronto";
    else if (especificoEstado[key] === "error") especificoEstadoItem = "erro";
    else especificoEstadoItem = "carregando";
  }
  return situacaoDaAposta(
    { created_at: item.created_at, concurso: item.concurso },
    {
      ultimo,
      anterior: anteriores[item.jogo] ?? null,
      anteriorEstado: anteriorEstadoItem,
      especifico,
      especificoEstado: especificoEstadoItem,
    },
  );
}

export function Studio({
  access,
  billingReady,
  billingError,
  previewUsed,
  historyOpen,
  onCloseHistory,
  onOpenHistory,
  onNeedAccess,
  onPreviewUsed,
  onRetryBilling,
}: {
  access: boolean;
  billingReady: boolean;
  billingError: boolean;
  previewUsed: boolean;
  historyOpen: boolean;
  onCloseHistory: () => void;
  onOpenHistory: () => void;
  onNeedAccess: () => void;
  onPreviewUsed: () => void;
  onRetryBilling: () => void;
}) {
  const [gameId, setGameId] = useState<GameId>("lotofacil");
  const game = GAME_MAP[gameId];
  const [mode, setMode] = useState<"estatistico" | "surpresa">("estatistico");
  const [resumo, setResumo] = useState<Partial<Record<GameId, ResumoEstatistica>>>({});
  const [resumoEstado, setResumoEstado] = useState<Partial<Record<GameId, "loading" | "error">>>({});
  const [count, setCount] = useState(1);
  const [pick, setPick] = useState(game.pickMin);
  const [hot, setHot] = useState<number[]>([]);
  const [trevos, setTrevos] = useState(2);
  const [mes, setMes] = useState(0);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<SavedBet | null>(null);
  const [history, setHistory] = useState<SavedBet[]>([]);
  const [copied, setCopied] = useState("");
  const [gapOn, setGapOn] = useState(false);
  const [gapMax, setGapMax] = useState(3);
  const [tarefa, setTarefa] = useState<"gerar" | "cobertura">("gerar");
  const [pool, setPool] = useState<number[]>([]);
  const [coberturaView, setCoberturaView] = useState<CoberturaLotofacil | null>(null);
  const [retro, setRetro] = useState<{ id: string; janela: number; rotulo: string; vezes: number[]; erro: boolean } | null>(null);
  const [sorteios, setSorteios] = useState<Partial<Record<GameId, Sorteio>>>({});
  const [resultadoEstado, setResultadoEstado] = useState<Partial<Record<GameId, "loading" | "error">>>({});
  const [anteriores, setAnteriores] = useState<Partial<Record<GameId, Sorteio>>>({});
  const [anteriorEstado, setAnteriorEstado] = useState<Partial<Record<GameId, "pronto" | "erro">>>({});
  const [especificos, setEspecificos] = useState<Record<string, Sorteio>>({});
  const [especificoEstado, setEspecificoEstado] = useState<Record<string, "error" | "ready">>({});
  const pedidos = useRef(new Set<GameId>());
  const pedidosExtra = useRef(new Set<string>());
  const vivo = useRef(true);

  const pedirSorteio = useCallback((jogo: GameId, fresh = false) => {
    if (!fresh && pedidos.current.has(jogo)) return;
    pedidos.current.add(jogo);
    setResultadoEstado((prev) => ({ ...prev, [jogo]: "loading" }));
    const path = fresh ? `/api/resultados?jogo=${jogo}&fresh=1` : `/api/resultados?jogo=${jogo}`;
    api<{ sorteio: Sorteio }>(path)
      .then((res) => {
        if (!vivo.current) return;
        setSorteios((prev) => ({ ...prev, [jogo]: res.sorteio }));
        setResultadoEstado((prev) => {
          const next = { ...prev };
          delete next[jogo];
          return next;
        });
      })
      .catch(() => {
        pedidos.current.delete(jogo);
        if (!vivo.current) return;
        setResultadoEstado((prev) => ({ ...prev, [jogo]: "error" }));
      });
  }, []);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  useEffect(() => {
    setPick(GAME_MAP[gameId].pickMin);
    setHot([]);
    setPool([]);
    setTarefa("gerar");
    setCoberturaView(null);
    setCurrent(null);
    setError("");
  }, [gameId]);

  const pedidosEstat = useRef(new Set<GameId>());
  const pedirEstatisticas = useCallback((jogo: GameId, fresh = false) => {
    if (!fresh && pedidosEstat.current.has(jogo)) return;
    pedidosEstat.current.add(jogo);
    setResumoEstado((prev) => ({ ...prev, [jogo]: "loading" }));
    api<ResumoEstatistica>(`/api/estatisticas?jogo=${jogo}`)
      .then((res) => {
        if (!vivo.current) return;
        setResumo((prev) => ({ ...prev, [jogo]: res }));
        setResumoEstado((prev) => {
          const next = { ...prev };
          delete next[jogo];
          return next;
        });
      })
      .catch(() => {
        pedidosEstat.current.delete(jogo);
        if (!vivo.current) return;
        setResumoEstado((prev) => ({ ...prev, [jogo]: "error" }));
      });
  }, []);

  useEffect(() => {
    pedirSorteio(gameId);
  }, [gameId, pedirSorteio]);

  useEffect(() => {
    if (mode !== "estatistico") return;
    if (resumo[gameId] || resumoEstado[gameId]) return;
    pedirEstatisticas(gameId);
  }, [mode, gameId, resumo, resumoEstado, pedirEstatisticas]);

  useEffect(() => {
    if (!historyOpen) return;
    for (const item of history) {
      if (isGameId(item.jogo)) pedirSorteio(item.jogo);
    }
  }, [historyOpen, history, pedirSorteio]);

  useEffect(() => {
    const jogos = new Set<GameId>([gameId]);
    for (const item of history) {
      if (isGameId(item.jogo)) jogos.add(item.jogo);
    }
    if (current && isGameId(current.jogo)) jogos.add(current.jogo);

    for (const jogo of jogos) {
      const ultimo = sorteios[jogo];
      if (!ultimo) continue;
      const legado =
        history.some((item) => item.jogo === jogo && item.concurso == null) ||
        (current?.jogo === jogo && current.concurso == null);
      if (legado && ultimo.numero > 1) {
        const key = `ant:${jogo}:${ultimo.numero - 1}`;
        if (!pedidosExtra.current.has(key)) {
          pedidosExtra.current.add(key);
          const numero = ultimo.numero - 1;
          api<{ sorteio: Sorteio }>(`/api/resultados?jogo=${jogo}&concurso=${numero}`)
            .then((res) => {
              if (!vivo.current) return;
              setAnteriores((prev) => ({ ...prev, [jogo]: res.sorteio }));
              setAnteriorEstado((prev) => ({ ...prev, [jogo]: "pronto" }));
            })
            .catch(() => {
              if (!vivo.current) return;
              setAnteriorEstado((prev) => ({ ...prev, [jogo]: "erro" }));
            });
        }
      }

      const alvos = new Set<number>();
      for (const item of history) {
        if (item.jogo === jogo && item.concurso && item.concurso < ultimo.numero) alvos.add(item.concurso);
      }
      if (current?.jogo === jogo && current.concurso && current.concurso < ultimo.numero) alvos.add(current.concurso);
      for (const numero of alvos) {
        const key = `${jogo}:${numero}`;
        if (pedidosExtra.current.has(key)) continue;
        pedidosExtra.current.add(key);
        api<{ sorteio: Sorteio }>(`/api/resultados?jogo=${jogo}&concurso=${numero}`)
          .then((res) => {
            if (!vivo.current) return;
            setEspecificos((prev) => ({ ...prev, [key]: res.sorteio }));
            setEspecificoEstado((prev) => ({ ...prev, [key]: "ready" }));
          })
          .catch(() => {
            if (!vivo.current) return;
            setEspecificoEstado((prev) => ({ ...prev, [key]: "error" }));
          });
      }
    }
  }, [sorteios, history, current, gameId]);

  useEffect(() => {
    if (!access) {
      setHistory([]);
      return;
    }
    api<{ items: SavedBet[] }>("/api/apostas")
      .then((res) => setHistory(res.items))
      .catch(() => setHistory([]));
  }, [access]);

  const sorteio = sorteios[gameId] ?? null;
  const conferenciaDoJogo = useMemo(() => {
    if (!sorteio) return { apostas: 0, premiadas: 0 };
    const itens = history.filter((item) => item.jogo === gameId);
    if (current && current.jogo === gameId && !itens.some((item) => item.id === current.id)) itens.push(current);
    let apostas = 0;
    let premiadas = 0;
    for (const item of itens) {
      const situacao = resolverSituacao(item, sorteios, anteriores, anteriorEstado, especificos, especificoEstado);
      if (situacao.tipo !== "conferida" || situacao.sorteio.numero !== sorteio.numero) continue;
      for (const bet of item.bets) {
        apostas += 1;
        if (conferir(gameId, bet, situacao.sorteio, item.created_at).premiada) premiadas += 1;
      }
    }
    return { apostas, premiadas };
  }, [sorteio, history, current, gameId, sorteios, anteriores, anteriorEstado, especificos, especificoEstado]);

  const price = useMemo(() => quote(game, pick, trevos), [game, pick, trevos]);
  const total = price.total * count;
  const cols = game.max <= 25 ? "5" : game.max <= 31 ? "7" : "10";
  const numbers = useMemo(() => {
    const list: number[] = [];
    for (let n = game.min; n <= game.max; n++) list.push(n);
    return list;
  }, [game]);

  const amostraDisponivel = billingReady && !access && !previewUsed;
  const marcados = tarefa === "cobertura" ? pool : hot;

  function toggleHot(n: number) {
    setHot((prev) => {
      if (prev.includes(n)) return prev.filter((item) => item !== n);
      if (prev.length >= Math.min(10, pick)) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  }

  function togglePool(n: number) {
    setPool((prev) => {
      if (prev.includes(n)) return prev.filter((item) => item !== n);
      if (prev.length >= 20) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
    setCoberturaView(null);
  }

  function usarFrequentes() {
    const lista = resumo[gameId]?.frequentes ?? [];
    const limite = Math.min(10, pick);
    setHot(lista.filter((n) => n >= game.min && n <= game.max).slice(0, limite));
  }

  async function generate() {
    if (tarefa === "cobertura") {
      if (!access) {
        onNeedAccess();
        return;
      }
      const resultado = coberturaLotofacil(pool);
      if (!resultado) {
        setError("Marque de 16 a 20 dezenas no volante.");
        return;
      }
      setError("");
      setCurrent(null);
      setCoberturaView(resultado);
      return;
    }
    if (!access && !amostraDisponivel) {
      onNeedAccess();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api<SavedBet>("/api/apostas", {
        method: "POST",
        body: {
          jogo: gameId,
          count: access ? count : 1,
          pick,
          mode,
          hot,
          trevos,
          mes: mes || null,
          time: time || null,
          preview: !access,
          gapMax: gapOn && gameId === "lotofacil" && pick === 15 && mode === "estatistico" ? gapMax : null,
        },
      });
      setCoberturaView(null);
      setCurrent(saved);
      if (saved.preview) onPreviewUsed();
      else setHistory((prev) => [saved, ...prev].slice(0, 30));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.message.includes("amostra"))) onNeedAccess();
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarCobertura() {
    if (!coberturaView || !access) {
      onNeedAccess();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api<SavedBet>("/api/apostas", {
        method: "POST",
        body: { jogo: "lotofacil", fixas: coberturaView.jogos },
      });
      setCurrent(saved);
      setCoberturaView(null);
      setTarefa("gerar");
      setHistory((prev) => [saved, ...prev].slice(0, 30));
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) onNeedAccess();
      setError(err instanceof ApiError ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function copyBet(bet: BetView) {
    const line = [
      bet.numbers.map((n) => padNumber(n, game.pad)).join(" "),
      bet.trevos ? `trevos ${bet.trevos.join(" ")}` : "",
      bet.mes ? bet.mes : "",
      bet.time ? bet.time : "",
    ]
      .filter(Boolean)
      .join(" · ");
    await navigator.clipboard.writeText(line);
    setCopied(line);
  }

  const retroAlvo = useMemo(() => {
    if (current) return { id: current.id, jogo: current.jogo, bets: current.bets };
    if (!coberturaView) return null;
    const bets: BetView[] = coberturaView.jogos.map((numbers) => ({
      numbers,
      stats: { evens: 0, odds: 0, sum: 0 },
    }));
    return {
      id: `cobertura:${coberturaView.dezenas.join("-")}:${coberturaView.jogos.length}`,
      jogo: "lotofacil" as const,
      bets,
    };
  }, [current, coberturaView]);

  useEffect(() => {
    if (!retroAlvo || !billingReady) {
      setRetro(null);
      return;
    }
    const janela = access ? 100 : 20;
    const id = retroAlvo.id;
    let cancel = false;
    setRetro({ id, janela, rotulo: "", vezes: [], erro: false });
    api<{ janela: number; rotulo: string; vezes: number[] }>("/api/retro", {
      method: "POST",
      body: {
        jogo: retroAlvo.jogo,
        janela,
        bets: retroAlvo.bets.map((bet) => ({
          numbers: bet.numbers,
          trevos: bet.trevos,
          mes: bet.mes,
          time: bet.time,
        })),
      },
    })
      .then((res) => {
        if (!cancel) setRetro({ id, janela: res.janela, rotulo: res.rotulo, vezes: res.vezes, erro: false });
      })
      .catch(() => {
        if (!cancel) setRetro({ id, janela, rotulo: "", vezes: [], erro: true });
      });
    return () => {
      cancel = true;
    };
  }, [retroAlvo, access, billingReady]);

  function linhaRetro(id: string, index: number): string {
    if (!retro || retro.id !== id) return "";
    if (retro.erro) return "Não foi possível medir os concursos anteriores agora.";
    if (!retro.rotulo) return "Conferindo os concursos anteriores…";
    const prefixo = access ? "" : "Amostra: ";
    return `${prefixo}Nos últimos ${retro.janela} concursos, ${retro.rotulo} em ${retro.vezes[index] ?? 0}.`;
  }

  const botaoGerar = busy
    ? tarefa === "cobertura"
      ? "Guardando…"
      : "Gerando…"
    : tarefa === "cobertura"
      ? "Ver cobertura"
      : !billingReady
        ? billingError
          ? "Tentar de novo"
          : "Carregando…"
        : access
          ? "Gerar jogos"
          : amostraDisponivel
            ? "Gerar 1 jogo grátis"
            : "Assinar para gerar mais";

  return (
    <div>
      <div className="chips" role="tablist" aria-label="Jogos">
        {GAMES.map((item) => (
          <button
            key={item.id}
            className="chip"
            type="button"
            aria-pressed={item.id === gameId}
            style={{ ["--accent" as string]: item.accent }}
            onClick={() => setGameId(item.id)}
          >
            <i className="dot" />
            {item.name}
          </button>
        ))}
      </div>

      {conferenciaDoJogo.premiadas > 0 && sorteio && (
        <div className="banner">
          {conferenciaDoJogo.premiadas}{" "}
          {conferenciaDoJogo.premiadas === 1 ? "aposta pontuou" : "apostas pontuaram"} no concurso {sorteio.numero}.{" "}
          <button className="text-btn" type="button" onClick={onOpenHistory}>
            Ver histórico
          </button>
        </div>
      )}

      {!access && (
        <div className="banner">
          {!billingReady && billingError && (
            <>
              Não foi possível conferir o acesso.{" "}
              <button className="text-btn" type="button" onClick={onRetryBilling}>
                Tentar de novo
              </button>
            </>
          )}
          {!billingReady && !billingError && "Conferindo o acesso…"}
          {billingReady && amostraDisponivel && (
            <>
              O primeiro jogo é grátis e não entra no histórico.{" "}
              <button className="text-btn" type="button" onClick={onNeedAccess}>
                Ver planos
              </button>
            </>
          )}
          {billingReady && !amostraDisponivel && (
            <>
              A amostra grátis já foi usada. O histórico e os próximos jogos ficam no plano.{" "}
              <button className="text-btn" type="button" onClick={onNeedAccess}>
                Ver planos
              </button>
            </>
          )}
        </div>
      )}

      <div className="workspace" style={{ ["--accent" as string]: game.accent }}>
        <section className="panel stack">
          <div>
            <p className="kicker">{game.schedule}</p>
            <h2>{game.name}</h2>
            <p className="muted">{game.blurb}</p>
          </div>

          <div className="modes">
            <button type="button" aria-pressed={mode === "estatistico"} onClick={() => setMode("estatistico")}>
              Estatísticas
            </button>
            <button type="button" aria-pressed={mode === "surpresa"} onClick={() => setMode("surpresa")}>
              Surpresinha
            </button>
          </div>
          {mode === "estatistico" && (
            <EstatisticaResumo
              gameId={gameId}
              pad={game.pad}
              data={resumo[gameId]}
              estado={resumoEstado[gameId]}
              onRetry={() => pedirEstatisticas(gameId, true)}
            />
          )}

          {tarefa === "gerar" && (
            <>
          <label>
            Apostas: {count}
            <input type="range" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </label>

          {game.pickMin !== game.pickMax && (
            <label>
              Dezenas: {pick}
              <input
                type="range"
                min={game.pickMin}
                max={game.pickMax}
                value={pick}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPick(next);
                  setHot((prev) => prev.slice(0, next));
                }}
              />
            </label>
          )}

          {game.id === "maismilionaria" && (
            <label>
              Trevos: {trevos}
              <input type="range" min={2} max={6} value={trevos} onChange={(e) => setTrevos(Number(e.target.value))} />
            </label>
          )}

          {game.id === "diadesorte" && (
            <label>
              Mês da sorte
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                <option value={0}>Sortear mês</option>
                {MESES.map((nome, index) => (
                  <option key={nome} value={index + 1}>
                    {nome}
                  </option>
                ))}
              </select>
            </label>
          )}

          {game.id === "timemania" && (
            <label>
              Time do Coração
              <select value={time} onChange={(e) => setTime(e.target.value)}>
                <option value="">Sortear time</option>
                {TIMES.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </select>
            </label>
          )}
            </>
          )}

          {game.id === "lotofacil" && pick === 15 && mode === "estatistico" && tarefa === "gerar" && (
            <div className="fold">
              <label className="check">
                <input type="checkbox" checked={gapOn} onChange={(event) => setGapOn(event.target.checked)} />
                Limitar salto entre dezenas
              </label>
              {gapOn && (
                <label>
                  Salto máximo: {gapMax}
                  <input type="range" min={2} max={5} value={gapMax} onChange={(event) => setGapMax(Number(event.target.value))} />
                </label>
              )}
              <p className="fine">
                Desligado, o volante segue pares, soma e o histórico. Ligado, dezenas ordenadas ficam a no máximo esse salto.
              </p>
            </div>
          )}

          {game.id === "lotofacil" && (
            <div className="fold">
              <button
                type="button"
                aria-pressed={tarefa === "cobertura"}
                onClick={() => {
                  setTarefa((atual) => (atual === "cobertura" ? "gerar" : "cobertura"));
                  setCoberturaView(null);
                  setError("");
                }}
              >
                Cobrir com menos bilhetes
              </button>
              {tarefa === "cobertura" && (
                <p className="fine">
                  Marque de 16 a 20 dezenas no volante. Os filtros de geração ficam de fora enquanto a cobertura está aberta.
                  {pool.length < 16 ? ` Faltam ${16 - pool.length}.` : ""}
                </p>
              )}
            </div>
          )}

          {tarefa === "gerar" && (
            <p className="range">
              <span>
                {price.combos} combinação{price.combos === 1 ? "" : "ões"} por aposta
              </span>
              <strong>{formatBRL(total)}</strong>
            </p>
          )}
          <button
            className="solid"
            type="button"
            onClick={() => {
              if (!billingReady) {
                if (billingError) onRetryBilling();
                return;
              }
              void generate();
            }}
            disabled={busy || (!billingReady && !billingError) || (tarefa === "cobertura" && (pool.length < 16 || pool.length > 20))}
          >
            {botaoGerar}
          </button>
          <p className="error">{error}</p>
          <p className="fine">
            {tarefa === "cobertura"
              ? "A cobertura reduz a quantidade de bilhetes para uma faixa combinada. Cada jogo de 15 continua com a mesma chance."
              : mode === "estatistico"
                ? game.id === "supersete"
                  ? "Estatísticas prioriza, em cada coluna, o dígito mais frequente, o atrasado e o repetido do último concurso. Cada combinação continua com a mesma chance."
                  : "Estatísticas prioriza as dezenas que mais saíram, as atrasadas e as repetidas do último concurso. Cada combinação continua com a mesma chance."
                : "Surpresinha sorteia o volante sem esses filtros. Cada combinação continua com a mesma chance."}
          </p>
        </section>

        <section className="panel">
          <ResultadoCard
            gameId={gameId}
            sorteio={sorteio}
            estado={resultadoEstado[gameId]}
            apostas={conferenciaDoJogo.apostas}
            premiadas={conferenciaDoJogo.premiadas}
            onRefresh={() => pedirSorteio(gameId, true)}
          />
          {game.id === "supersete" ? (
            <p className="muted">O Super Sete sorteia um dígito independente em cada coluna. A aposta simples marca um número por coluna.</p>
          ) : (
            <>
              <div className="spread">
                <h3>{tarefa === "cobertura" ? "Dezenas da cobertura" : "Favoritos"}</h3>
                <span className="muted">{tarefa === "cobertura" ? `${pool.length}/20` : `${hot.length}/10`}</span>
              </div>
              {tarefa === "gerar" && mode === "estatistico" && (
                <button className="text-btn" type="button" onClick={usarFrequentes}>
                  Usar as frequentes
                </button>
              )}
              <p className="legend">
                <span><i className="swatch freq" /> Frequente</span>
                <span><i className="swatch atraso" /> Atrasada</span>
                <span><i className="swatch repetida" /> Repetida</span>
                <span><i className="swatch fav" /> {tarefa === "cobertura" ? "Marcada" : "Favorita"}</span>
              </p>
              <p className="fine">
                {tarefa === "cobertura"
                  ? "Estas dezenas formam o grupo da cobertura."
                  : "Elas têm prioridade. Se não couberem na regra do jogo, o volante segue sem forçar."}
              </p>
              <div className="volante" data-cols={cols}>
                {numbers.map((n) => {
                  const papel = resumo[gameId];
                  const classes = ["ball"];
                  if (papel?.frequentes.includes(n)) classes.push("is-freq");
                  if (papel?.atrasadas.includes(n)) classes.push("is-atraso");
                  if (papel?.repetidas.includes(n)) classes.push("is-repetida");
                  return (
                    <button
                      key={n}
                      type="button"
                      className={classes.join(" ")}
                      aria-pressed={marcados.includes(n)}
                      onClick={() => (tarefa === "cobertura" ? togglePool(n) : toggleHot(n))}
                    >
                      {padNumber(n, game.pad)}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {coberturaView && (
            <div style={{ marginTop: 22 }}>
              <div className="spread">
                <h3>Cobertura</h3>
                <span>{formatBRL(coberturaView.total)}</span>
              </div>
              <p className="fine">
                {coberturaView.jogos.length} jogos em vez de {coberturaView.completos}. Todas as combinações sairiam por{" "}
                {formatBRL(coberturaView.totalCheio)}.
              </p>
              <p className="fine">{coberturaView.frase}</p>
              {coberturaView.jogos.map((numbers, index) => (
                <BetCard
                  key={`cobertura-${index}`}
                  bet={{ numbers, stats: { evens: numbers.filter((n) => n % 2 === 0).length, odds: numbers.filter((n) => n % 2 !== 0).length, sum: numbers.reduce((a, b) => a + b, 0) } }}
                  index={index}
                  gameId="lotofacil"
                  gamePad={2}
                  sorteio={null}
                  pendente=""
                  createdAt=""
                  copied={copied}
                  retroLinha={linhaRetro(retroAlvo?.id ?? "", index)}
                  onCopy={copyBet}
                />
              ))}
              <button className="solid" type="button" onClick={() => void guardarCobertura()} disabled={busy}>
                {busy ? "Guardando…" : "Guardar estes jogos"}
              </button>
            </div>
          )}

          {current && (
            <div style={{ marginTop: 22 }}>
              <div className="spread">
                <h3>Jogos gerados</h3>
                <span>{formatBRL(current.total)}</span>
              </div>
              {current.preview && <p className="fine">Este jogo não entra no histórico.</p>}
              {current.bets.map((bet, index) => {
                const situacao =
                  current.jogo === gameId
                    ? resolverSituacao(current, sorteios, anteriores, anteriorEstado, especificos, especificoEstado)
                    : null;
                const draw = situacao?.tipo === "conferida" ? situacao.sorteio : null;
                const pendente = !situacao
                  ? ""
                  : situacao.tipo === "carregando"
                    ? "Conferindo o resultado…"
                    : situacao.tipo === "conferida"
                      ? ""
                      : situacao.resumo;
                return (
                  <BetCard
                    key={`${current.id}-${index}`}
                    bet={bet}
                    index={index}
                    gameId={game.id}
                    gamePad={game.pad}
                    sorteio={draw}
                    pendente={pendente}
                    createdAt={current.created_at}
                    copied={copied}
                    retroLinha={linhaRetro(current.id, index)}
                    onCopy={copyBet}
                  />
                );
              })}
            </div>
          )}

        </section>
      </div>
      {historyOpen && (
        <HistoryDrawer
          access={access}
          history={history}
          sorteios={sorteios}
          anteriores={anteriores}
          anteriorEstado={anteriorEstado}
          especificos={especificos}
          especificoEstado={especificoEstado}
          onClose={onCloseHistory}
          onNeedAccess={onNeedAccess}
        />
      )}
    </div>
  );
}

function EstatisticaResumo({
  gameId,
  pad,
  data,
  estado,
  onRetry,
}: {
  gameId: GameId;
  pad: number;
  data: ResumoEstatistica | undefined;
  estado: "loading" | "error" | undefined;
  onRetry: () => void;
}) {
  if (!data && estado === "error") {
    return (
      <p className="fine">
        As estatísticas não carregaram. O volante segue só com o filtro de pares, soma e primos.{" "}
        <button className="text-btn" type="button" onClick={onRetry}>
          Tentar de novo
        </button>
      </p>
    );
  }
  if (!data) return <p className="fine">Lendo os últimos concursos…</p>;

  if (gameId === "supersete" && data.colunas) {
    return (
      <p className="fine">
        Últimos {data.janela} concursos, até o {data.concurso}. Dígito mais frequente:{" "}
        {data.colunas.map((coluna, index) => `C${index + 1} ${coluna.frequente}`).join(" · ")}
      </p>
    );
  }

  return (
    <div className="stat-note">
      <p className="fine">
        Últimos {data.janela} concursos, até o {data.concurso}. As repetidas desse concurso também entram no peso.
      </p>
      <p className="fine">Frequentes {data.frequentes.map((n) => padNumber(n, pad)).join(" ")}</p>
      <p className="fine">
        Atrasadas {data.atrasadas.length ? data.atrasadas.map((n) => padNumber(n, pad)).join(" ") : "nenhuma fora das frequentes"}
      </p>
      {data.trevosFrequentes.length > 0 && <p className="fine">Trevos frequentes {data.trevosFrequentes.join(" ")}</p>}
      {data.mesFrequente && <p className="fine">Mês mais frequente {data.mesFrequente}</p>}
    </div>
  );
}

function HistoryDrawer({
  access,
  history,
  sorteios,
  anteriores,
  anteriorEstado,
  especificos,
  especificoEstado,
  onClose,
  onNeedAccess,
}: {
  access: boolean;
  history: SavedBet[];
  sorteios: Partial<Record<GameId, Sorteio>>;
  anteriores: Partial<Record<GameId, Sorteio>>;
  anteriorEstado: Partial<Record<GameId, "pronto" | "erro">>;
  especificos: Record<string, Sorteio>;
  especificoEstado: Record<string, "error" | "ready">;
  onClose: () => void;
  onNeedAccess: () => void;
}) {
  const [gameFilter, setGameFilter] = useState<GameId | "todos">("todos");
  const filtered =
    gameFilter === "todos" ? history : history.filter((item) => item.jogo === gameFilter);
  const selectedName = gameFilter === "todos" ? "" : GAME_MAP[gameFilter].name;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="history-screen">
      <section className="history-modal" role="dialog" aria-modal="true" aria-label="Histórico">
        <div className="history-head">
          <div>
            <h2>Histórico</h2>
            <label className="history-filter">
              Jogo
              <select
                value={gameFilter}
                aria-label="Filtrar histórico por jogo"
                onChange={(event) => setGameFilter(event.target.value as GameId | "todos")}
              >
                <option value="todos">Todos os jogos</option>
                {GAMES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="ghost" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
        {!access && (
          <p className="history-note">
            O histórico fica liberado depois do pagamento.{" "}
            <button className="text-btn" type="button" onClick={onNeedAccess}>
              Ver planos
            </button>
          </p>
        )}
        {access && history.length === 0 && <p className="muted history-note">Nenhuma aposta gerada ainda.</p>}
        {access && history.length > 0 && filtered.length === 0 && (
          <p className="muted history-note">Nenhuma aposta de {selectedName} ainda.</p>
        )}
        <div className="history-grid">
          {filtered.map((item) => {
            const game = GAME_MAP[item.jogo as GameId];
            const situacao = resolverSituacao(item, sorteios, anteriores, anteriorEstado, especificos, especificoEstado);
            const draw = situacao.tipo === "conferida" ? situacao.sorteio : null;
            return (
              <article className="history-card" key={item.id}>
                <header>
                  <strong>{game?.name ?? item.jogo}</strong>
                  <span className="muted">{formatTimestampBR(item.created_at)}</span>
                </header>
                <p className="muted">
                  {item.quantidade} aposta{item.quantidade === 1 ? "" : "s"} · {formatBRL(item.total)}
                </p>
                {item.bets.map((bet, index) => {
                  const check = draw ? conferir(draw.jogo, bet, draw, item.created_at) : null;
                  const rotulo =
                    draw && check?.aplicavel
                      ? `${check.resumo} · concurso ${draw.numero}`
                      : check
                        ? check.resumo
                        : situacao.tipo === "aguardando" || situacao.tipo === "indisponivel"
                          ? situacao.resumo
                          : "Conferindo o resultado…";
                  const marcar = (value: number, ball: number) =>
                    draw && check?.aplicavel && dezenaAcertou(draw.jogo, value, ball, draw) ? "num hit" : "num";
                  return (
                    <div className={check?.premiada ? "history-bet premiada" : "history-bet"} key={`${item.id}-${index}`}>
                      {bet.columns ? (
                        <div className="columns">
                          {bet.columns.map((digit, column) => (
                            <div className="column" key={column}>
                              <span>C{column + 1}</span>
                              <div className={marcar(digit, column)}>{digit}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="history-balls">
                          {bet.numbers.map((n, ball) => (
                            <span className={marcar(n, ball)} key={`${n}-${ball}`}>
                              {padNumber(n, game?.pad ?? 2)}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="history-extra">
                        <span className={check?.premiada ? "pill win" : "pill"}>{rotulo}</span>
                        {bet.trevos ? `Trevos ${bet.trevos.join(" ")}` : ""}
                        {bet.mes ? bet.mes : ""}
                        {bet.time ? bet.time : ""}
                        {bet.stats.concursoBase !== undefined && (
                          <span>
                            {bet.stats.frequentes ?? 0} frequentes · {bet.stats.atrasadas ?? 0} atrasadas · {bet.stats.repetidas ?? 0}{" "}
                            repetidas do {bet.stats.concursoBase}
                          </span>
                        )}
                      </p>
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function BetCard({
  bet,
  index,
  gameId,
  gamePad,
  sorteio,
  pendente,
  createdAt,
  copied,
  retroLinha,
  onCopy,
}: {
  bet: BetView;
  index: number;
  gameId: GameId;
  gamePad: number;
  sorteio: Sorteio | null;
  pendente: string;
  createdAt: string;
  copied: string;
  retroLinha: string;
  onCopy: (bet: BetView) => void;
}) {
  const line = bet.numbers.map((n) => padNumber(n, gamePad)).join(" ");
  const check = sorteio && sorteio.jogo === gameId ? conferir(gameId, bet, sorteio, createdAt) : null;
  const aplicavel = Boolean(check?.aplicavel);
  const rotulo = aplicavel && sorteio ? `${check?.resumo} · concurso ${sorteio.numero}` : check?.resumo || pendente;
  return (
    <article className={check?.premiada ? "ticket premiada" : "ticket"}>
      <header>
        <strong>Aposta {index + 1}</strong>
        <button className="text-btn" type="button" onClick={() => onCopy(bet)}>
          {copied.startsWith(line) ? "Copiado" : "Copiar"}
        </button>
      </header>
      {bet.columns ? (
        <div className="columns">
          {bet.columns.map((digit, column) => (
            <div className="column" key={column}>
              <span>C{column + 1}</span>
              <div className={markClass(sorteio, gameId, digit, column, aplicavel)}>{digit}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="numbers">
          {bet.numbers.map((n, ball) => (
            <div className={markClass(sorteio, gameId, n, ball, aplicavel)} key={`${n}-${ball}`}>
              {padNumber(n, gamePad)}
            </div>
          ))}
        </div>
      )}
      <div className="extras">
        {rotulo && <span className={check?.premiada ? "pill win" : "pill"}>{rotulo}</span>}
        <span className="pill">
          {bet.stats.evens} pares · {bet.stats.odds} ímpares
        </span>
        <span className="pill">Soma {bet.stats.sum}</span>
        {bet.stats.primes !== undefined && <span className="pill">{bet.stats.primes} primos</span>}
        {bet.stats.concursoBase !== undefined && (
          <span className="pill">
            {bet.stats.frequentes ?? 0} frequentes · {bet.stats.atrasadas ?? 0} atrasadas · {bet.stats.repetidas ?? 0} repetidas do{" "}
            {bet.stats.concursoBase}
          </span>
        )}
        {bet.trevos && (
          <span className={aplicavel && check?.trevos ? "pill win" : "pill"}>Trevos {bet.trevos.map((n) => padNumber(n, 1)).join(" ")}</span>
        )}
        {bet.mes && <span className={aplicavel && check?.extra ? "pill win" : "pill"}>{bet.mes}</span>}
        {bet.time && <span className={aplicavel && check?.extra ? "pill win" : "pill"}>{bet.time}</span>}
      </div>
      {retroLinha && <p className="fine">{retroLinha}</p>}
    </article>
  );
}

function markClass(sorteio: Sorteio | null, gameId: GameId, value: number, index: number, aplicavel: boolean): string {
  if (!sorteio || sorteio.jogo !== gameId || !aplicavel) return "num";
  return dezenaAcertou(gameId, value, index, sorteio) ? "num hit" : "num";
}

function ResultadoCard({
  gameId,
  sorteio,
  estado,
  apostas,
  premiadas,
  onRefresh,
}: {
  gameId: GameId;
  sorteio: Sorteio | null;
  estado: "loading" | "error" | undefined;
  apostas: number;
  premiadas: number;
  onRefresh: () => void;
}) {
  const game = GAME_MAP[gameId];
  if (!sorteio && estado === "error") {
    return (
      <p className="error">
        Não foi possível consultar o resultado.{" "}
        <button className="text-btn" type="button" onClick={onRefresh}>
          Tentar de novo
        </button>
      </p>
    );
  }
  if (!sorteio) {
    return <p className="muted">Buscando o último resultado…</p>;
  }

  return (
    <article className="draw">
      <div className="spread">
        <div>
          <p className="kicker">Concurso {sorteio.numero}</p>
          {sorteio.dataProximo && (
            <p className="next-draw">
              Próximo sorteio em {sorteio.dataProximo}
              {sorteio.estimativaProximo ? ` · estimativa ${formatBRL(sorteio.estimativaProximo)}` : ""}
            </p>
          )}
          <h3>Resultado · {sorteio.dataApuracao}</h3>
        </div>
        <button className="text-btn" type="button" onClick={onRefresh} disabled={estado === "loading"}>
          {estado === "loading" ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      <p className="muted">{sorteio.acumulado ? "Acumulou" : "Teve ganhador na faixa principal"}</p>
      <div className="numbers">
        {sorteio.dezenas.map((n, index) => (
          <div className="num hot" key={`${index}-${n}`}>
            {padNumber(n, game.pad)}
          </div>
        ))}
      </div>
      {sorteio.dezenasSegundo.length > 0 && (
        <>
          <p className="fine">2º sorteio</p>
          <div className="numbers">
            {sorteio.dezenasSegundo.map((n, index) => (
              <div className="num hot" key={`s-${index}-${n}`}>
                {padNumber(n, game.pad)}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="draw-meta">
        {sorteio.trevos.length > 0 && <span className="pill">Trevos {sorteio.trevos.join(" ")}</span>}
        {gameId === "timemania" && sorteio.extra && <span className="pill">Time {sorteio.extra}</span>}
        {gameId === "diadesorte" && sorteio.extra && <span className="pill">{sorteio.extra}</span>}
      </div>
      {apostas > 0 ? (
        <p className={premiadas > 0 ? "draw-win" : "muted"}>
          {premiadas > 0
            ? `${premiadas} ${premiadas === 1 ? "aposta premiada" : "apostas premiadas"} no concurso ${sorteio.numero}.`
            : `Nenhuma aposta salva entrou em faixa no concurso ${sorteio.numero}.`}
        </p>
      ) : (
        <p className="fine">No histórico, as dezenas só ficam verdes depois do resultado do concurso da aposta.</p>
      )}
      <p className="fine">A conferência usa o resultado publicado. O volante continua só no Aposta Certa.</p>
    </article>
  );
}
