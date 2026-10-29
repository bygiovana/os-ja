import { criarApp } from "./app.js";
import { carregarConfig } from "./config.js";
import { migrar } from "./db/migrate.js";
import { criarPool } from "./db/pool.js";

const cfg = carregarConfig();
const db = criarPool(cfg.databaseUrl, cfg.fusoHorario);

await migrar(db);
const servidor = criarApp(db, cfg).listen(cfg.porta, cfg.host, () => {
  console.log(`Gestão de OS rodando em http://localhost:${cfg.porta} (escutando em ${cfg.host})`);
  if (!cfg.usuario) console.warn("Aviso: sem APP_USUARIO/APP_SENHA, qualquer pessoa na rede acessa o sistema.");
});

function encerrar(sinal: string) {
  console.log(`${sinal} recebido, encerrando...`);
  servidor.close(() => db.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));
