"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { GAMES, GAME_MAP, padNumber, type GameId } from "@/lib/games";
import type { Sorteio } from "@/lib/types";

export function ResultadosScreen({ onClose }: { onClose: () => void }) {
  const [gameId, setGameId] = useState<GameId>("lotofacil");
  const [concurso, setConcurso] = useState("");
  const [sorteio, setSorteio] = useState<Sorteio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pedido = useRef(0);
  const game = GAME_MAP[gameId];

  const carregar = useCallback(async (jogo: GameId, numero?: number) => {
    const id = ++pedido.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ jogo });
    if (numero) params.set("concurso", String(numero));
    try {
      const res = await api<{ sorteio: Sorteio }>(`/api/resultados?${params}`);
      if (pedido.current !== id) return;
      setSorteio(res.sorteio);
      setConcurso(String(res.sorteio.numero));
    } catch (err) {
      if (pedido.current !== id) return;
      setSorteio(null);
      setError(err instanceof ApiError ? err.message : "Não foi possível consultar o resultado.");
    } finally {
      if (pedido.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar(gameId);
  }, [gameId, carregar]);

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

  function buscarConcurso(event: FormEvent) {
    event.preventDefault();
    const numero = Number(concurso.trim());
    if (!Number.isInteger(numero) || numero < 1) {
      setError("Informe o número do concurso.");
      setSorteio(null);
      return;
    }
    void carregar(gameId, numero);
  }

  return (
    <div className="history-screen">
      <section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="resultados-titulo">
        <div className="history-head">
          <div>
            <p className="kicker">Consulta</p>
            <h2 id="resultados-titulo">Resultados</h2>
          </div>
          <button className="ghost" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>

        <form className="resultados-form" onSubmit={buscarConcurso}>
          <label>
            Jogo
            <select
              value={gameId}
              aria-label="Jogo"
              onChange={(event) => setGameId(event.target.value as GameId)}
            >
              {GAMES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Concurso
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="Número"
              aria-label="Número do concurso"
              value={concurso}
              onChange={(event) => setConcurso(event.target.value.replace(/\D/g, "").slice(0, 5))}
            />
          </label>
          <div className="resultados-actions">
            <button className="solid" type="submit" disabled={loading}>
              {loading ? "Buscando…" : "Buscar"}
            </button>
            <button className="ghost" type="button" disabled={loading} onClick={() => void carregar(gameId)}>
              Último concurso
            </button>
          </div>
        </form>

        {error && <p className="error resultados-status">{error}</p>}
        {!error && loading && (!sorteio || sorteio.jogo !== gameId) && (
          <p className="muted resultados-status">Buscando o resultado…</p>
        )}

        {sorteio && sorteio.jogo === gameId && (
          <article className="resultados-board" style={{ ["--accent" as string]: game.accent }}>
            <p className="kicker">
              {game.name} · concurso {sorteio.numero}
            </p>
            <h3 className="resultados-title">{sorteio.dataApuracao}</h3>
            <p className="muted">{sorteio.acumulado ? "Acumulou" : "Teve ganhador na faixa principal"}</p>

            {gameId === "supersete" ? (
              <div className="columns resultados-columns">
                {sorteio.dezenas.map((digit, column) => (
                  <div className="column" key={column}>
                    <span>C{column + 1}</span>
                    <div className="num hot">{digit}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="numbers">
                {sorteio.dezenas.map((n, index) => (
                  <div className="num hot" key={`${index}-${n}`}>
                    {padNumber(n, game.pad)}
                  </div>
                ))}
              </div>
            )}

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
              {sorteio.trevos.length > 0 && <span className="pill">Trevos {sorteio.trevos.map((n) => padNumber(n, 1)).join(" ")}</span>}
              {gameId === "timemania" && sorteio.extra && <span className="pill">Time {sorteio.extra}</span>}
              {gameId === "diadesorte" && sorteio.extra && <span className="pill">{sorteio.extra}</span>}
            </div>

            {sorteio.dataProximo && (
              <p className="fine">
                Próximo sorteio em {sorteio.dataProximo}
                {sorteio.estimativaProximo ? ` · estimativa ${formatBRL(sorteio.estimativaProximo)}` : ""}
              </p>
            )}
          </article>
        )}
      </section>
    </div>
  );
}
