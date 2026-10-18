"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatBRL, formatTimestampBR } from "@/lib/format";
import { GAMES, GAME_MAP, MESES, TIMES, padNumber, quote, type GameId } from "@/lib/games";
import type { BetView, SavedBet } from "@/lib/types";

export function Studio({ access, onNeedAccess }: { access: boolean; onNeedAccess: () => void }) {
  const [gameId, setGameId] = useState<GameId>("lotofacil");
  const game = GAME_MAP[gameId];
  const [mode, setMode] = useState<"balanceado" | "surpresa">("balanceado");
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

  useEffect(() => {
    setPick(GAME_MAP[gameId].pickMin);
    setHot([]);
    setCurrent(null);
    setError("");
  }, [gameId]);

  useEffect(() => {
    if (!access) {
      setHistory([]);
      return;
    }
    api<{ items: SavedBet[] }>("/api/apostas")
      .then((res) => setHistory(res.items))
      .catch(() => setHistory([]));
  }, [access]);

  const price = useMemo(() => quote(game, pick, trevos), [game, pick, trevos]);
  const total = price.total * count;
  const cols = game.max <= 25 ? "5" : game.max <= 31 ? "7" : "10";
  const numbers = useMemo(() => {
    const list: number[] = [];
    for (let n = game.min; n <= game.max; n++) list.push(n);
    return list;
  }, [game]);

  function toggleHot(n: number) {
    setHot((prev) => {
      if (prev.includes(n)) return prev.filter((item) => item !== n);
      if (prev.length >= Math.min(10, pick)) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  }

  async function generate() {
    if (!access) {
      onNeedAccess();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api<SavedBet>("/api/apostas", {
        method: "POST",
        body: { jogo: gameId, count, pick, mode, hot, trevos, mes: mes || null, time: time || null },
      });
      setCurrent(saved);
      setHistory((prev) => [saved, ...prev].slice(0, 30));
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) onNeedAccess();
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar.");
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

      {!access && (
        <div className="banner">
          A geração e o histórico ficam liberados depois do pagamento.{" "}
          <button className="text-btn" type="button" onClick={onNeedAccess}>
            Ver planos
          </button>
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
            <button type="button" aria-pressed={mode === "balanceado"} onClick={() => setMode("balanceado")}>
              Balanceado
            </button>
            <button type="button" aria-pressed={mode === "surpresa"} onClick={() => setMode("surpresa")}>
              Surpresinha
            </button>
          </div>

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

          <p className="range">
            <span>
              {price.combos} combinação{price.combos === 1 ? "" : "ões"} por aposta
            </span>
            <strong>{formatBRL(total)}</strong>
          </p>
          <button className="solid" type="button" onClick={generate} disabled={busy}>
            {busy ? "Gerando…" : access ? "Gerar jogos" : "Assinar para gerar"}
          </button>
          <p className="error">{error}</p>
          <p className="fine">
            Os filtros deixam o volante parecido com os padrões mais comuns. Cada combinação continua com a mesma chance.
          </p>
        </section>

        <section className="panel">
          {game.id === "supersete" ? (
            <p className="muted">O Super Sete sorteia um dígito independente em cada coluna. A aposta simples marca um número por coluna.</p>
          ) : (
            <>
              <div className="spread">
                <h3>Favoritos</h3>
                <span className="muted">{hot.length}/10</span>
              </div>
              <p className="fine">Eles têm prioridade. Se não couberem na regra do jogo, o volante segue sem forçar.</p>
              <div className="volante" data-cols={cols}>
                {numbers.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="ball"
                    aria-pressed={hot.includes(n)}
                    onClick={() => toggleHot(n)}
                  >
                    {padNumber(n, game.pad)}
                  </button>
                ))}
              </div>
            </>
          )}

          {current && (
            <div style={{ marginTop: 22 }}>
              <div className="spread">
                <h3>Jogos gerados</h3>
                <span>{formatBRL(current.total)}</span>
              </div>
              {current.bets.map((bet, index) => (
                <BetCard key={`${current.id}-${index}`} bet={bet} index={index} gamePad={game.pad} copied={copied} onCopy={copyBet} />
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h3>Seu histórico</h3>
              {history.map((item) => (
                <article className="history-item" key={item.id}>
                  <header>
                    <strong>{GAME_MAP[item.jogo as GameId]?.name ?? item.jogo}</strong>
                    <span className="muted">{formatTimestampBR(item.created_at)}</span>
                  </header>
                  <p className="muted">
                    {item.quantidade} aposta{item.quantidade === 1 ? "" : "s"} · {formatBRL(item.total)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function BetCard({
  bet,
  index,
  gamePad,
  copied,
  onCopy,
}: {
  bet: BetView;
  index: number;
  gamePad: number;
  copied: string;
  onCopy: (bet: BetView) => void;
}) {
  const line = bet.numbers.map((n) => padNumber(n, gamePad)).join(" ");
  return (
    <article className="ticket">
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
              <div className="num hot">{digit}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="numbers">
          {bet.numbers.map((n) => (
            <div className="num" key={n}>
              {padNumber(n, gamePad)}
            </div>
          ))}
        </div>
      )}
      <div className="extras">
        <span className="pill">
          {bet.stats.evens} pares · {bet.stats.odds} ímpares
        </span>
        <span className="pill">Soma {bet.stats.sum}</span>
        {bet.stats.primes !== undefined && <span className="pill">{bet.stats.primes} primos</span>}
        {bet.trevos && <span className="pill">Trevos {bet.trevos.map((n) => padNumber(n, 1)).join(" ")}</span>}
        {bet.mes && <span className="pill">{bet.mes}</span>}
        {bet.time && <span className="pill">{bet.time}</span>}
      </div>
    </article>
  );
}
