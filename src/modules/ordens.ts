import { z } from "zod";
import { emTransacao, type Db, type Executor, type Tx } from "../db/pool.js";
import {
  ROTULO_STATUS,
  STATUS_OS,
  TransicaoInvalidaError,
  calcularTotais,
  permiteEditarItens,
  proximosStatus,
  totalItem,
  validarTransicao,
  type StatusOS,
  type Totais,
} from "../domain/ordem-servico.js";
import {
  atualizarOrdemEntrada,
  idParam,
  itemEntrada,
  mudarStatusEntrada,
  novaOrdemEntrada,
  type ItemEntrada,
} from "../http/esquemas.js";
import { ErroHttp, naoEncontrado, type Router } from "../http/router.js";
import { buscarCliente, padraoBusca, salvarClientePorDados } from "./clientes.js";
import { buscarVeiculo, salvarVeiculoPorDados } from "./veiculos.js";

export interface ClienteSnapshot {
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
}

export interface VeiculoSnapshot {
  placa: string;
  marca: string;
  modelo: string;
  ano: number | null;
  cor: string | null;
  chassi: string | null;
  combustivel: string | null;
}

export interface ItemOS {
  id: number;
  tipo: "servico" | "peca";
  codigo: string | null;
  descricao: string;
  quantidade: number;
  valorUnitarioCentavos: number;
  totalCentavos: number;
}

export interface EventoOS {
  tipo: string;
  de: string | null;
  para: string | null;
  detalhe: string | null;
  criadoEm: Date;
}

export interface OrdemServico {
  id: number;
  numero: number;
  status: StatusOS;
  statusRotulo: string;
  proximosStatus: { status: StatusOS; rotulo: string }[];
  editavel: boolean;
  clienteId: number;
  veiculoId: number;
  cliente: ClienteSnapshot;
  veiculo: VeiculoSnapshot;
  kmEntrada: number | null;
  defeitoRelatado: string;
  diagnostico: string | null;
  observacoes: string | null;
  previsaoEntrega: string | null;
  formaPagamento: string | null;
  motivoCancelamento: string | null;
  abertaEm: Date;
  aprovadaEm: Date | null;
  concluidaEm: Date | null;
  entregueEm: Date | null;
  itens: ItemOS[];
  totais: Totais;
  eventos: EventoOS[];
}

export async function buscarOrdem(ex: Executor, id: number): Promise<OrdemServico | null> {
  const { rows } = await ex.query(
    `SELECT id, numero, status, cliente_id, veiculo_id, cliente_snapshot, veiculo_snapshot, km_entrada,
            defeito_relatado, diagnostico, observacoes,
            to_char(previsao_entrega, 'YYYY-MM-DD') AS previsao_entrega,
            desconto_centavos, forma_pagamento, motivo_cancelamento,
            aberta_em, aprovada_em, concluida_em, entregue_em
     FROM ordens_servico WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;

  const itensRes = await ex.query(
    `SELECT id, tipo, codigo, descricao, quantidade, valor_unitario_centavos
     FROM os_itens WHERE os_id = $1 ORDER BY tipo DESC, id`,
    [id],
  );
  const itens: ItemOS[] = itensRes.rows.map((i) => {
    const item = {
      tipo: i.tipo,
      quantidade: Number(i.quantidade),
      valorUnitarioCentavos: Number(i.valor_unitario_centavos),
    };
    return { id: i.id, codigo: i.codigo, descricao: i.descricao, ...item, totalCentavos: totalItem(item) };
  });

  const eventosRes = await ex.query(
    `SELECT tipo, de, para, detalhe, criado_em FROM os_eventos WHERE os_id = $1 ORDER BY id`,
    [id],
  );

  const status = r.status as StatusOS;
  return {
    id: r.id,
    numero: r.numero,
    status,
    statusRotulo: ROTULO_STATUS[status],
    proximosStatus: proximosStatus(status).map((s) => ({ status: s, rotulo: ROTULO_STATUS[s] })),
    editavel: permiteEditarItens(status),
    clienteId: r.cliente_id,
    veiculoId: r.veiculo_id,
    cliente: r.cliente_snapshot,
    veiculo: r.veiculo_snapshot,
    kmEntrada: r.km_entrada,
    defeitoRelatado: r.defeito_relatado,
    diagnostico: r.diagnostico,
    observacoes: r.observacoes,
    previsaoEntrega: r.previsao_entrega,
    formaPagamento: r.forma_pagamento,
    motivoCancelamento: r.motivo_cancelamento,
    abertaEm: r.aberta_em,
    aprovadaEm: r.aprovada_em,
    concluidaEm: r.concluida_em,
    entregueEm: r.entregue_em,
    itens,
    totais: calcularTotais(itens, Number(r.desconto_centavos)),
    eventos: eventosRes.rows.map((e) => ({
      tipo: e.tipo, de: e.de, para: e.para, detalhe: e.detalhe, criadoEm: e.criado_em,
    })),
  };
}

async function registrarEvento(
  tx: Tx,
  osId: number,
  tipo: string,
  extra: { de?: string; para?: string; detalhe?: string } = {},
): Promise<void> {
  await tx.query(`INSERT INTO os_eventos (os_id, tipo, de, para, detalhe) VALUES ($1, $2, $3, $4, $5)`, [
    osId, tipo, extra.de ?? null, extra.para ?? null, extra.detalhe ?? null,
  ]);
}

async function inserirItem(tx: Tx, osId: number, item: ItemEntrada): Promise<number> {
  const { rows } = await tx.query(
    `INSERT INTO os_itens (os_id, tipo, codigo, descricao, quantidade, valor_unitario_centavos)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [osId, item.tipo, item.codigo, item.descricao, item.quantidade, item.valorUnitarioCentavos],
  );
  return rows[0].id;
}

/** Trava a OS para a transação e devolve o status atual. */
async function travarOrdem(tx: Tx, id: number): Promise<StatusOS> {
  const { rows } = await tx.query(`SELECT status FROM ordens_servico WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw naoEncontrado("Ordem de serviço");
  return rows[0].status as StatusOS;
}

function exigirEditavel(status: StatusOS): void {
  if (!permiteEditarItens(status)) {
    throw new ErroHttp(409, `A OS está "${ROTULO_STATUS[status]}" e não aceita alteração de itens ou valores.`);
  }
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const filtroStatus = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter(Boolean) : []))
  .pipe(z.array(z.enum(STATUS_OS)));

export function rotasOrdens(router: Router, db: Db): void {
  router.get("/api/ordens", async ({ query }) => {
    const status = filtroStatus.parse(query.get("status") ?? undefined);
    const busca = query.get("busca")?.trim() ?? "";
    const limite = z.coerce.number().int().min(1).max(100).default(50).parse(query.get("limite") ?? undefined);
    const antesDe = z.coerce.number().int().positive().optional().parse(query.get("antesDe") || undefined);
    const numeroBusca = /^\d+$/.test(busca) ? Number(busca) : null;
    const placaBusca = busca.toUpperCase().replace(/[^A-Z0-9]/g, "");

    const { rows } = await db.query(
      `SELECT o.id, o.numero, o.status, o.aberta_em, to_char(o.previsao_entrega, 'YYYY-MM-DD') AS previsao_entrega,
              o.cliente_snapshot->>'nome' AS cliente_nome, o.cliente_snapshot->>'telefone' AS telefone,
              o.veiculo_snapshot->>'placa' AS placa,
              concat_ws(' ', o.veiculo_snapshot->>'marca', o.veiculo_snapshot->>'modelo') AS veiculo,
              (coalesce(t.subtotal, 0) - least(o.desconto_centavos, coalesce(t.subtotal, 0)))::bigint AS total
       FROM ordens_servico o
       LEFT JOIN LATERAL (
         SELECT sum(round(quantidade * valor_unitario_centavos)) AS subtotal FROM os_itens WHERE os_id = o.id
       ) t ON true
       WHERE (cardinality($1::text[]) = 0 OR o.status = ANY ($1::text[]))
         AND ($2::int IS NULL OR o.numero < $2::int)
         AND ($3 = '' OR o.numero = $4::int OR o.veiculo_snapshot->>'placa' LIKE $5
              OR o.cliente_snapshot->>'nome' ILIKE $6)
       ORDER BY o.numero DESC
       LIMIT $7`,
      [status, antesDe ?? null, busca, numeroBusca, placaBusca ? padraoBusca(placaBusca) : null, padraoBusca(busca), limite + 1],
    );
    const temMais = rows.length > limite;
    const pagina = rows.slice(0, limite);
    return {
      json: {
        itens: pagina.map((r) => ({
          id: r.id,
          numero: r.numero,
          status: r.status,
          statusRotulo: ROTULO_STATUS[r.status as StatusOS],
          clienteNome: r.cliente_nome,
          telefone: r.telefone,
          placa: r.placa,
          veiculo: r.veiculo,
          abertaEm: r.aberta_em,
          previsaoEntrega: r.previsao_entrega,
          totalCentavos: Number(r.total),
        })),
        proximo: temMais ? pagina[pagina.length - 1].numero : null,
      },
    };
  });

  router.post("/api/ordens", async ({ corpo }) => {
    const d = novaOrdemEntrada.parse(corpo);
    const id = await emTransacao(db, async (tx) => {
      const cliente =
        "nome" in d.cliente
          ? await salvarClientePorDados(tx, d.cliente)
          : await buscarCliente(tx, d.cliente.id);
      if (!cliente) throw naoEncontrado("Cliente");

      let veiculo;
      if ("placa" in d.veiculo) {
        veiculo = await salvarVeiculoPorDados(tx, cliente.id, d.veiculo);
      } else {
        veiculo = await buscarVeiculo(tx, d.veiculo.id);
        if (!veiculo) throw naoEncontrado("Veículo");
        if (veiculo.clienteId !== cliente.id) {
          throw new ErroHttp(400, `O veículo ${veiculo.placa} está cadastrado para outro cliente. Envie os dados do veículo para transferir.`);
        }
      }
      if (d.kmEntrada != null) {
        await tx.query(`UPDATE veiculos SET km_atual = GREATEST(km_atual, $2), atualizado_em = now() WHERE id = $1`, [
          veiculo.id, d.kmEntrada,
        ]);
      }

      const clienteSnapshot: ClienteSnapshot = {
        nome: cliente.nome, documento: cliente.documento, telefone: cliente.telefone,
        email: cliente.email, endereco: cliente.endereco,
      };
      const veiculoSnapshot: VeiculoSnapshot = {
        placa: veiculo.placa, marca: veiculo.marca, modelo: veiculo.modelo, ano: veiculo.ano,
        cor: veiculo.cor, chassi: veiculo.chassi, combustivel: veiculo.combustivel,
      };
      const { rows } = await tx.query(
        `INSERT INTO ordens_servico (cliente_id, veiculo_id, cliente_snapshot, veiculo_snapshot, km_entrada,
           defeito_relatado, observacoes, previsao_entrega)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, numero`,
        [
          cliente.id, veiculo.id, JSON.stringify(clienteSnapshot), JSON.stringify(veiculoSnapshot),
          d.kmEntrada ?? null, d.defeitoRelatado, d.observacoes, d.previsaoEntrega,
        ],
      );
      const osId: number = rows[0].id;
      for (const item of d.itens) await inserirItem(tx, osId, item);
      await registrarEvento(tx, osId, "aberta", { para: "orcamento", detalhe: `OS nº ${rows[0].numero} aberta` });
      return osId;
    });
    return { status: 201, json: await buscarOrdem(db, id) };
  });

  router.get("/api/ordens/:id", async ({ params }) => {
    const os = await buscarOrdem(db, idParam.parse(params.id));
    if (!os) throw naoEncontrado("Ordem de serviço");
    return { json: os };
  });

  router.patch("/api/ordens/:id", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const d = atualizarOrdemEntrada.parse(corpo);
    await emTransacao(db, async (tx) => {
      const status = await travarOrdem(tx, id);
      if (status === "entregue" || status === "cancelada") {
        throw new ErroHttp(409, `A OS está "${ROTULO_STATUS[status]}" e não pode mais ser alterada.`);
      }
      if (d.descontoCentavos !== undefined) exigirEditavel(status);

      const colunas: Record<string, unknown> = {
        diagnostico: d.diagnostico,
        observacoes: d.observacoes,
        previsao_entrega: d.previsaoEntrega,
        km_entrada: d.kmEntrada,
        desconto_centavos: d.descontoCentavos,
        forma_pagamento: d.formaPagamento,
      };
      const sets: string[] = [];
      const valores: unknown[] = [id];
      for (const [coluna, valor] of Object.entries(colunas)) {
        if (valor === undefined) continue;
        valores.push(valor);
        sets.push(`${coluna} = $${valores.length}`);
      }
      if (!sets.length) return;
      await tx.query(`UPDATE ordens_servico SET ${sets.join(", ")}, atualizado_em = now() WHERE id = $1`, valores);
      if (d.descontoCentavos !== undefined) {
        await registrarEvento(tx, id, "desconto", { detalhe: `Desconto definido em ${reais(d.descontoCentavos)}` });
      }
    });
    return { json: await buscarOrdem(db, id) };
  });

  router.post("/api/ordens/:id/itens", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const item = itemEntrada.parse(corpo);
    await emTransacao(db, async (tx) => {
      exigirEditavel(await travarOrdem(tx, id));
      await inserirItem(tx, id, item);
      await registrarEvento(tx, id, "item_adicionado", {
        detalhe: `${item.tipo === "servico" ? "Serviço" : "Peça"}: ${item.descricao} (${item.quantidade} × ${reais(item.valorUnitarioCentavos)})`,
      });
    });
    return { status: 201, json: await buscarOrdem(db, id) };
  });

  router.delete("/api/ordens/:id/itens/:itemId", async ({ params }) => {
    const id = idParam.parse(params.id);
    const itemId = idParam.parse(params.itemId);
    await emTransacao(db, async (tx) => {
      exigirEditavel(await travarOrdem(tx, id));
      const { rows } = await tx.query(`DELETE FROM os_itens WHERE id = $1 AND os_id = $2 RETURNING descricao`, [itemId, id]);
      if (!rows[0]) throw naoEncontrado("Item");
      await registrarEvento(tx, id, "item_removido", { detalhe: rows[0].descricao });
    });
    return { json: await buscarOrdem(db, id) };
  });

  router.post("/api/ordens/:id/status", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const { status: para, motivo } = mudarStatusEntrada.parse(corpo);
    await emTransacao(db, async (tx) => {
      const de = await travarOrdem(tx, id);
      try {
        validarTransicao(de, para, motivo);
      } catch (erro) {
        if (erro instanceof TransicaoInvalidaError) throw new ErroHttp(409, erro.message);
        throw new ErroHttp(400, (erro as Error).message);
      }
      if (para === "aprovada" || para === "concluida" || para === "entregue") {
        const { rows } = await tx.query(`SELECT count(*)::int AS n FROM os_itens WHERE os_id = $1`, [id]);
        if (rows[0].n === 0) throw new ErroHttp(400, "Adicione pelo menos um serviço ou peça antes de avançar a OS.");
      }
      await tx.query(
        `UPDATE ordens_servico SET
           status = $2,
           aprovada_em = CASE WHEN $2 = 'aprovada' THEN now() ELSE aprovada_em END,
           concluida_em = CASE WHEN $2 = 'concluida' THEN now() WHEN $2 = 'em_andamento' THEN NULL ELSE concluida_em END,
           entregue_em = CASE WHEN $2 = 'entregue' THEN now() ELSE entregue_em END,
           motivo_cancelamento = CASE WHEN $2 = 'cancelada' THEN $3 ELSE motivo_cancelamento END,
           atualizado_em = now()
         WHERE id = $1`,
        [id, para, motivo?.trim() || null],
      );
      await registrarEvento(tx, id, "status", { de, para, detalhe: motivo?.trim() || undefined });
    });
    return { json: await buscarOrdem(db, id) };
  });

  router.get("/api/resumo", async () => {
    const porStatus = await db.query(`SELECT status, count(*)::int AS n FROM ordens_servico GROUP BY status`);
    const mes = await db.query(
      `SELECT count(*)::int AS entregues,
              coalesce(sum(t.subtotal - least(o.desconto_centavos, t.subtotal)), 0)::bigint AS faturamento
       FROM ordens_servico o
       CROSS JOIN LATERAL (
         SELECT coalesce(sum(round(quantidade * valor_unitario_centavos)), 0) AS subtotal FROM os_itens WHERE os_id = o.id
       ) t
       WHERE o.status = 'entregue' AND o.entregue_em >= date_trunc('month', now())`,
    );
    const atrasadas = await db.query(
      `SELECT count(*)::int AS n FROM ordens_servico
       WHERE previsao_entrega < current_date AND status NOT IN ('concluida', 'entregue', 'cancelada')`,
    );
    const contagem = Object.fromEntries(STATUS_OS.map((s) => [s, 0])) as Record<StatusOS, number>;
    for (const r of porStatus.rows) contagem[r.status as StatusOS] = r.n;
    const entregues = mes.rows[0].entregues as number;
    const faturamento = Number(mes.rows[0].faturamento);
    return {
      json: {
        porStatus: contagem,
        abertas: contagem.orcamento + contagem.aprovada + contagem.em_andamento + contagem.aguardando_peca,
        prontasParaEntrega: contagem.concluida,
        atrasadas: atrasadas.rows[0].n,
        mes: {
          entregues,
          faturamentoCentavos: faturamento,
          ticketMedioCentavos: entregues ? Math.round(faturamento / entregues) : 0,
        },
      },
    };
  });
}
