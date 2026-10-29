// Roteador HTTP mínimo sobre node:http — sem framework, para manter o projeto leve.
import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";

export interface Requisicao {
  metodo: string;
  caminho: string;
  params: Record<string, string>;
  query: URLSearchParams;
  corpo: unknown;
}

export type Resposta =
  | { status?: number; json: unknown }
  | { status?: number; html: string }
  | { status: 204 };

export type Handler = (req: Requisicao) => Promise<Resposta>;

/** Erro com código HTTP e mensagem que pode ser mostrada ao usuário. */
export class ErroHttp extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

export const naoEncontrado = (o = "Registro") => new ErroHttp(404, `${o} não encontrado.`);

interface Rota {
  metodo: string;
  padrao: RegExp;
  nomes: string[];
  handler: Handler;
}

const LIMITE_CORPO = 1_000_000; // 1 MB

export class Router {
  private rotas: Rota[] = [];

  add(metodo: string, caminho: string, handler: Handler): this {
    const nomes: string[] = [];
    const padrao = new RegExp(
      "^" +
        caminho.replace(/:([a-zA-Z]+)/g, (_, nome: string) => {
          nomes.push(nome);
          return "([^/]+)";
        }) +
        "/?$",
    );
    this.rotas.push({ metodo, padrao, nomes, handler });
    return this;
  }

  get = (c: string, h: Handler) => this.add("GET", c, h);
  post = (c: string, h: Handler) => this.add("POST", c, h);
  put = (c: string, h: Handler) => this.add("PUT", c, h);
  patch = (c: string, h: Handler) => this.add("PATCH", c, h);
  delete = (c: string, h: Handler) => this.add("DELETE", c, h);

  /** Retorna true se tratou a requisição; false se nenhuma rota casou. */
  async tratar(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const metodo = req.method ?? "GET";
    let caminhoExiste = false;

    for (const rota of this.rotas) {
      const m = rota.padrao.exec(url.pathname);
      if (!m) continue;
      caminhoExiste = true;
      if (rota.metodo !== metodo) continue;

      const params: Record<string, string> = {};
      rota.nomes.forEach((nome, i) => (params[nome] = decodeURIComponent(m[i + 1])));
      try {
        const corpo = ["POST", "PUT", "PATCH"].includes(metodo) ? await lerJson(req) : undefined;
        const resposta = await rota.handler({ metodo, caminho: url.pathname, params, query: url.searchParams, corpo });
        enviar(res, resposta);
      } catch (erro) {
        enviarErro(res, erro);
      }
      return true;
    }

    if (caminhoExiste) {
      enviar(res, { status: 405, json: { erro: "Método não permitido." } });
      return true;
    }
    return false;
  }
}

async function lerJson(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += (parte as Buffer).length;
    if (tamanho > LIMITE_CORPO) throw new ErroHttp(413, "Requisição grande demais.");
    partes.push(parte as Buffer);
  }
  const texto = Buffer.concat(partes).toString("utf8").trim();
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroHttp(400, "JSON inválido no corpo da requisição.");
  }
}

export function enviar(res: ServerResponse, r: Resposta): void {
  const status = r.status ?? 200;
  if ("json" in r) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r.json));
  } else if ("html" in r) {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(r.html);
  } else {
    res.writeHead(status);
    res.end();
  }
}

function enviarErro(res: ServerResponse, erro: unknown): void {
  if (erro instanceof ZodError) {
    const detalhes = erro.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message }));
    const resumo = detalhes.map((d) => (d.campo ? `${d.campo}: ${d.mensagem}` : d.mensagem)).join("; ");
    enviar(res, { status: 400, json: { erro: `Dados inválidos — ${resumo}`, detalhes } });
    return;
  }
  if (erro instanceof ErroHttp) {
    enviar(res, { status: erro.status, json: { erro: erro.message, detalhes: erro.detalhes } });
    return;
  }
  const pgErro = erro as { code?: string; constraint?: string };
  if (pgErro?.code === "23505") {
    enviar(res, { status: 409, json: { erro: "Já existe um registro com esses dados.", restricao: pgErro.constraint } });
    return;
  }
  if (pgErro?.code === "23514" || pgErro?.code === "23503") {
    enviar(res, { status: 400, json: { erro: "Dados inconsistentes.", restricao: pgErro.constraint } });
    return;
  }
  console.error(erro);
  enviar(res, { status: 500, json: { erro: "Erro interno. Tente novamente." } });
}
