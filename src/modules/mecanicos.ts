import { networkInterfaces } from "node:os";
import { z } from "zod";
import type { Config } from "../config.js";
import { emTransacao, type Db } from "../db/pool.js";
import { ROTULO_STATUS } from "../domain/ordem-servico.js";
import { idParam } from "../http/esquemas.js";
import { ErroHttp, naoEncontrado, type Router } from "../http/router.js";
import { buscarOrdem, registrarEvento, travarOrdem } from "./ordens.js";

const nomeMecanico = z.string().trim().min(2, "informe o nome do mecânico").max(80);

const novoMecanico = z.object({ nome: nomeMecanico });
const alterarMecanico = z.object({ nome: nomeMecanico, ativo: z.boolean() }).partial();
const atribuir = z.object({ mecanicoId: idParam.nullable() });
const novaNota = z.object({
  mecanicoId: idParam.optional().nullable(),
  texto: z.string().trim().min(1, "escreva a anotação").max(2000),
});

/** Endereços IPv4 da rede local (Wi-Fi/cabo) para os celulares acessarem. */
export function enderecosRede(): string[] {
  const ips: string[] = [];
  for (const [nome, lista] of Object.entries(networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|wsl|docker|loopback|hyper-v/i.test(nome)) continue;
    for (const end of lista ?? []) {
      if (end.family === "IPv4" && !end.internal && !end.address.startsWith("169.254.")) ips.push(end.address);
    }
  }
  // redes domésticas/empresariais comuns primeiro
  const prioridade = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3);
  return [...new Set(ips)].sort((a, b) => prioridade(a) - prioridade(b));
}

export function rotasMecanicos(router: Router, db: Db, cfg: Config): void {
  router.get("/api/mecanicos", async ({ query }) => {
    const todos = query.get("todos") === "1";
    const { rows } = await db.query(
      `SELECT m.id, m.nome, m.ativo,
              (SELECT count(*)::int FROM ordens_servico o
                WHERE o.mecanico_id = m.id AND o.status IN ('aprovada', 'em_andamento', 'aguardando_peca')) AS em_aberto
       FROM mecanicos m WHERE $1 OR m.ativo ORDER BY m.ativo DESC, lower(m.nome)`,
      [todos],
    );
    return { json: rows.map((r) => ({ id: r.id, nome: r.nome, ativo: r.ativo, emAberto: r.em_aberto })) };
  });

  router.post("/api/mecanicos", async ({ corpo }) => {
    const { nome } = novoMecanico.parse(corpo);
    const { rows } = await db.query(
      `INSERT INTO mecanicos (nome) VALUES ($1)
       ON CONFLICT (lower(btrim(nome))) DO UPDATE SET ativo = true
       RETURNING id, nome, ativo`,
      [nome],
    );
    return { status: 201, json: rows[0] };
  });

  router.patch("/api/mecanicos/:id", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const d = alterarMecanico.parse(corpo);
    const { rows } = await db.query(
      `UPDATE mecanicos SET nome = coalesce($2, nome), ativo = coalesce($3, ativo) WHERE id = $1
       RETURNING id, nome, ativo`,
      [id, d.nome ?? null, d.ativo ?? null],
    );
    if (!rows[0]) throw naoEncontrado("Mecânico");
    return { json: rows[0] };
  });

  router.put("/api/ordens/:id/mecanico", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const { mecanicoId } = atribuir.parse(corpo);
    await emTransacao(db, async (tx) => {
      const status = await travarOrdem(tx, id);
      if (status === "entregue" || status === "cancelada") {
        throw new ErroHttp(409, `A OS está "${ROTULO_STATUS[status]}" e não pode mudar de responsável.`);
      }
      let nome: string | null = null;
      if (mecanicoId != null) {
        const { rows } = await tx.query(`SELECT nome FROM mecanicos WHERE id = $1 AND ativo`, [mecanicoId]);
        if (!rows[0]) throw naoEncontrado("Mecânico");
        nome = rows[0].nome;
      }
      await tx.query(`UPDATE ordens_servico SET mecanico_id = $2, atualizado_em = now() WHERE id = $1`, [id, mecanicoId]);
      await registrarEvento(tx, id, "mecanico", { detalhe: nome ? `Responsável: ${nome}` : "Sem responsável" });
    });
    return { json: await buscarOrdem(db, id) };
  });

  router.post("/api/ordens/:id/notas", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const { mecanicoId, texto } = novaNota.parse(corpo);
    await emTransacao(db, async (tx) => {
      const status = await travarOrdem(tx, id);
      if (status === "entregue" || status === "cancelada") {
        throw new ErroHttp(409, `A OS está "${ROTULO_STATUS[status]}" e não recebe mais anotações.`);
      }
      let autor = "Escritório";
      if (mecanicoId != null) {
        const { rows } = await tx.query(`SELECT nome FROM mecanicos WHERE id = $1`, [mecanicoId]);
        if (!rows[0]) throw naoEncontrado("Mecânico");
        autor = rows[0].nome;
      }
      await tx.query(`INSERT INTO os_notas (os_id, mecanico_id, autor, texto) VALUES ($1, $2, $3, $4)`, [
        id, mecanicoId ?? null, autor, texto,
      ]);
    });
    return { status: 201, json: await buscarOrdem(db, id) };
  });

  // Dados para a tela "Conectar celulares"
  router.get("/api/conexao", async () => {
    const soLocal = ["127.0.0.1", "localhost", "::1"].includes(cfg.host);
    return {
      json: {
        acessoRede: !soLocal,
        loginAtivo: Boolean(cfg.usuario),
        porta: cfg.porta,
        enderecos: soLocal ? [] : enderecosRede().map((ip) => `http://${ip}:${cfg.porta}/#/m`),
      },
    };
  });
}
