// Copia arquivos que o TypeScript não copia (SQL das migrações) para dist/.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/db/migrations", { recursive: true });
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
console.log("assets copiados para dist/");
