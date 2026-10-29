import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import type { Db } from "./db/pool.js";
import { enviar, Router } from "./http/router.js";
import { rotasClientes } from "./modules/clientes.js";
import { rotasImpressao } from "./modules/impressao.js";
import { rotasMecanicos } from "./modules/mecanicos.js";
import { rotasOrdens } from "./modules/ordens.js";
import { rotasVeiculos } from "./modules/veiculos.js";

const PUBLICO = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const CABECALHOS_SEGURANCA = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/** Arquivos sem dados da oficina que o celular busca antes de pedir a senha (ícone do app). */
const PUBLICO_SEM_LOGIN = (caminho: string) =>
  caminho === "/api/saude" || caminho === "/manifest.webmanifest" || caminho === "/favicon.svg" ||
  /^\/icones\/[\w-]+\.png$/.test(caminho);

function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function autorizado(req: IncomingMessage, cfg: Config): boolean {
  if (!cfg.usuario || !cfg.senha) return true;
  const cabecalho = req.headers.authorization ?? "";
  if (!cabecalho.startsWith("Basic ")) return false;
  const [usuario, ...resto] = Buffer.from(cabecalho.slice(6), "base64").toString("utf8").split(":");
  return igualSeguro(usuario, cfg.usuario) && igualSeguro(resto.join(":"), cfg.senha);
}

async function servirEstatico(caminho: string, res: ServerResponse): Promise<boolean> {
  const relativo = caminho === "/" ? "index.html" : decodeURIComponent(caminho).replace(/^\/+/, "");
  const arquivo = normalize(join(PUBLICO, relativo));
  if (!arquivo.startsWith(PUBLICO + sep)) return false; // bloqueia ../
  try {
    const conteudo = await readFile(arquivo);
    res.writeHead(200, {
      "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(conteudo);
    return true;
  } catch {
    return false;
  }
}

export function criarApp(db: Db, cfg: Config): Server {
  const router = new Router();
  router.get("/api/saude", async () => {
    await db.query("SELECT 1");
    return { json: { ok: true } };
  });
  router.get("/api/config", async () => ({ json: { nomeOficina: cfg.nomeOficina } }));
  rotasClientes(router, db);
  rotasVeiculos(router, db);
  rotasOrdens(router, db);
  rotasImpressao(router, db, cfg);
  rotasMecanicos(router, db, cfg);

  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CABECALHOS_SEGURANCA)) res.setHeader(k, v);
    const caminho = new URL(req.url ?? "/", "http://localhost").pathname;

    if (!PUBLICO_SEM_LOGIN(caminho) && !autorizado(req, cfg)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="OS Ja", charset="UTF-8"' });
      res.end("Acesso restrito.");
      return;
    }
    try {
      if (await router.tratar(req, res)) return;
      if (req.method === "GET" && !caminho.startsWith("/api/") && (await servirEstatico(caminho, res))) return;
      enviar(res, { status: 404, json: { erro: "Página não encontrada." } });
    } catch (erro) {
      console.error(erro);
      if (!res.headersSent) enviar(res, { status: 500, json: { erro: "Erro interno." } });
    }
  });
}
