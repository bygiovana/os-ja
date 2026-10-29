import { carregarConfig } from "../config.js";
import { migrar } from "./migrate.js";
import { criarPool } from "./pool.js";

const db = criarPool(carregarConfig().databaseUrl, carregarConfig().fusoHorario);
try {
  const novas = await migrar(db);
  console.log(novas.length ? `${novas.length} migração(ões) aplicada(s).` : "Banco já está atualizado.");
} finally {
  await db.end();
}
