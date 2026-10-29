import { z } from "zod";
import type { Db, Executor } from "../db/pool.js";
import { idParam, placa, veiculoEntrada, type VeiculoEntrada } from "../http/esquemas.js";
import { naoEncontrado, type Router } from "../http/router.js";
import { buscarCliente } from "./clientes.js";

export interface Veiculo {
  id: number;
  clienteId: number;
  placa: string;
  marca: string;
  modelo: string;
  ano: number | null;
  cor: string | null;
  chassi: string | null;
  combustivel: string | null;
  kmAtual: number | null;
}

const COLUNAS = "id, cliente_id, placa, marca, modelo, ano, cor, chassi, combustivel, km_atual";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapearVeiculo(r: any): Veiculo {
  return {
    id: r.id,
    clienteId: r.cliente_id,
    placa: r.placa,
    marca: r.marca,
    modelo: r.modelo,
    ano: r.ano,
    cor: r.cor,
    chassi: r.chassi,
    combustivel: r.combustivel,
    kmAtual: r.km_atual,
  };
}

export async function buscarVeiculo(ex: Executor, id: number): Promise<Veiculo | null> {
  const { rows } = await ex.query(`SELECT ${COLUNAS} FROM veiculos WHERE id = $1`, [id]);
  return rows[0] ? mapearVeiculo(rows[0]) : null;
}

/**
 * Cadastra o veículo para o cliente. Se a placa já existir, atualiza os dados e o dono
 * (o carro pode ter sido vendido). A quilometragem nunca diminui.
 */
export async function salvarVeiculoPorDados(ex: Executor, clienteId: number, d: VeiculoEntrada): Promise<Veiculo> {
  const { rows } = await ex.query(
    `INSERT INTO veiculos (cliente_id, placa, marca, modelo, ano, cor, chassi, combustivel, km_atual)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (placa) DO UPDATE SET
       cliente_id = EXCLUDED.cliente_id,
       marca = EXCLUDED.marca,
       modelo = EXCLUDED.modelo,
       ano = COALESCE(EXCLUDED.ano, veiculos.ano),
       cor = COALESCE(EXCLUDED.cor, veiculos.cor),
       chassi = COALESCE(EXCLUDED.chassi, veiculos.chassi),
       combustivel = COALESCE(EXCLUDED.combustivel, veiculos.combustivel),
       km_atual = GREATEST(veiculos.km_atual, EXCLUDED.km_atual),
       atualizado_em = now()
     RETURNING ${COLUNAS}`,
    [clienteId, d.placa, d.marca, d.modelo, d.ano ?? null, d.cor, d.chassi, d.combustivel, d.kmAtual ?? null],
  );
  return mapearVeiculo(rows[0]);
}

const novoVeiculo = veiculoEntrada.extend({ clienteId: idParam });

export function rotasVeiculos(router: Router, db: Db): void {
  // ?placa=ABC1D23 → busca exata (preenche o formulário da OS); ?clienteId=1 → veículos do cliente
  router.get("/api/veiculos", async ({ query }) => {
    const placaBusca = query.get("placa");
    if (placaBusca) {
      const p = placa.safeParse(placaBusca);
      if (!p.success) return { json: null };
      const { rows } = await db.query(`SELECT ${COLUNAS} FROM veiculos WHERE placa = $1`, [p.data]);
      if (!rows[0]) return { json: null };
      const veiculo = mapearVeiculo(rows[0]);
      return { json: { ...veiculo, cliente: await buscarCliente(db, veiculo.clienteId) } };
    }
    const clienteId = z.coerce.number().int().positive().parse(query.get("clienteId"));
    const { rows } = await db.query(`SELECT ${COLUNAS} FROM veiculos WHERE cliente_id = $1 ORDER BY placa`, [clienteId]);
    return { json: rows.map(mapearVeiculo) };
  });

  router.post("/api/veiculos", async ({ corpo }) => {
    const { clienteId, ...dados } = novoVeiculo.parse(corpo);
    if (!(await buscarCliente(db, clienteId))) throw naoEncontrado("Cliente");
    return { status: 201, json: await salvarVeiculoPorDados(db, clienteId, dados) };
  });

  router.put("/api/veiculos/:id", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const d = veiculoEntrada.parse(corpo);
    const { rows } = await db.query(
      `UPDATE veiculos SET placa = $2, marca = $3, modelo = $4, ano = $5, cor = $6, chassi = $7,
         combustivel = $8, km_atual = $9, atualizado_em = now()
       WHERE id = $1 RETURNING ${COLUNAS}`,
      [id, d.placa, d.marca, d.modelo, d.ano ?? null, d.cor, d.chassi, d.combustivel, d.kmAtual ?? null],
    );
    if (!rows[0]) throw naoEncontrado("Veículo");
    return { json: mapearVeiculo(rows[0]) };
  });
}
