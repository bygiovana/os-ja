import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emTransacao, type Db } from "./pool.js";

const PASTA = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const TRAVA = 4_242_001; // advisory lock: evita duas instâncias migrando ao mesmo tempo

/** Aplica, em ordem, os arquivos .sql ainda não registrados em schema_migrations. */
export async function migrar(db: Db, log: (msg: string) => void = console.log): Promise<string[]> {
  const arquivos = (await readdir(PASTA)).filter((f) => f.endsWith(".sql")).sort();
  return emTransacao(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [TRAVA]);
    await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await tx.query<{ nome: string }>("SELECT nome FROM schema_migrations");
    const aplicadas = new Set(rows.map((r) => r.nome));
    const novas: string[] = [];
    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      const sql = await readFile(join(PASTA, arquivo), "utf8");
      await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations (nome) VALUES ($1)", [arquivo]);
      log(`migração aplicada: ${arquivo}`);
      novas.push(arquivo);
    }
    return novas;
  });
}
