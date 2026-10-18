const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(value: number): string {
  return brl.format(value);
}

export function formatTimestampBR(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
