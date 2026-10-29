import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
/** Qualquer coisa que execute SQL: o pool ou um cliente dentro de transação. */
export type Executor = Pick<pg.Pool, "query">;

export function criarPool(connectionString: string, fusoHorario = "America/Sao_Paulo"): Db {
  if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(fusoHorario)) throw new Error(`Fuso horário inválido: ${fusoHorario}`);
  return new pg.Pool({
    connectionString,
    max: 10,
    statement_timeout: 10_000,
    // "Faturamento do mês" e "atrasadas" usam o calendário local da oficina.
    options: `-c TimeZone=${fusoHorario}`,
  });
}

export async function emTransacao<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    const resultado = await fn(tx);
    await tx.query("COMMIT");
    return resultado;
  } catch (erro) {
    await tx.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    tx.release();
  }
}
