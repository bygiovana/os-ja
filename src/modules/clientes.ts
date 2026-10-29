import type { Db, Executor } from "../db/pool.js";
import { clienteEntrada, idParam, type ClienteEntrada } from "../http/esquemas.js";
import { ErroHttp, naoEncontrado, type Router } from "../http/router.js";

export interface Cliente {
  id: number;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

const COLUNAS = "id, nome, documento, telefone, email, endereco, observacoes, criado_em, atualizado_em";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapearCliente(r: any): Cliente {
  return {
    id: r.id,
    nome: r.nome,
    documento: r.documento,
    telefone: r.telefone,
    email: r.email,
    endereco: r.endereco,
    observacoes: r.observacoes,
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
}

/** Escapa curingas do LIKE para que o texto digitado seja buscado literalmente. */
export function padraoBusca(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function buscarCliente(ex: Executor, id: number): Promise<Cliente | null> {
  const { rows } = await ex.query(`SELECT ${COLUNAS} FROM clientes WHERE id = $1`, [id]);
  return rows[0] ? mapearCliente(rows[0]) : null;
}

/**
 * Cadastra o cliente; se já existir alguém com o mesmo CPF/CNPJ, atualiza os dados de contato
 * informados (campos vazios não apagam o que já estava salvo).
 */
export async function salvarClientePorDados(ex: Executor, d: ClienteEntrada): Promise<Cliente> {
  const valores = [d.nome, d.documento, d.telefone, d.email, d.endereco, d.observacoes];
  if (d.documento) {
    const { rows } = await ex.query(
      `INSERT INTO clientes (nome, documento, telefone, email, endereco, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (documento) DO UPDATE SET
         nome = EXCLUDED.nome,
         telefone = COALESCE(EXCLUDED.telefone, clientes.telefone),
         email = COALESCE(EXCLUDED.email, clientes.email),
         endereco = COALESCE(EXCLUDED.endereco, clientes.endereco),
         observacoes = COALESCE(EXCLUDED.observacoes, clientes.observacoes),
         atualizado_em = now()
       RETURNING ${COLUNAS}`,
      valores,
    );
    return mapearCliente(rows[0]);
  }
  const { rows } = await ex.query(
    `INSERT INTO clientes (nome, documento, telefone, email, endereco, observacoes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUNAS}`,
    valores,
  );
  return mapearCliente(rows[0]);
}

export function rotasClientes(router: Router, db: Db): void {
  router.get("/api/clientes", async ({ query }) => {
    const busca = query.get("busca")?.trim() ?? "";
    const digitos = busca.replace(/\D/g, "");
    const { rows } = await db.query(
      `SELECT ${COLUNAS} FROM clientes
       WHERE $1 = ''
          OR nome ILIKE $2
          OR ($3 <> '' AND (documento LIKE $4 OR regexp_replace(coalesce(telefone, ''), '\\D', '', 'g') LIKE $4))
       ORDER BY lower(nome)
       LIMIT 50`,
      [busca, padraoBusca(busca), digitos, padraoBusca(digitos)],
    );
    return { json: rows.map(mapearCliente) };
  });

  router.post("/api/clientes", async ({ corpo }) => {
    const dados = clienteEntrada.parse(corpo);
    if (dados.documento) {
      const { rowCount } = await db.query("SELECT 1 FROM clientes WHERE documento = $1", [dados.documento]);
      if (rowCount) throw new ErroHttp(409, "Já existe um cliente com esse CPF/CNPJ.");
    }
    return { status: 201, json: await salvarClientePorDados(db, dados) };
  });

  router.get("/api/clientes/:id", async ({ params }) => {
    const id = idParam.parse(params.id);
    const cliente = await buscarCliente(db, id);
    if (!cliente) throw naoEncontrado("Cliente");
    const veiculos = await db.query(
      `SELECT id, placa, marca, modelo, ano, cor, km_atual FROM veiculos WHERE cliente_id = $1 ORDER BY placa`,
      [id],
    );
    const ordens = await db.query(
      `SELECT id, numero, status, aberta_em, veiculo_snapshot->>'placa' AS placa
       FROM ordens_servico WHERE cliente_id = $1 ORDER BY numero DESC LIMIT 100`,
      [id],
    );
    return {
      json: {
        ...cliente,
        veiculos: veiculos.rows.map((v) => ({
          id: v.id, placa: v.placa, marca: v.marca, modelo: v.modelo, ano: v.ano, cor: v.cor, kmAtual: v.km_atual,
        })),
        ordens: ordens.rows.map((o) => ({ id: o.id, numero: o.numero, status: o.status, abertaEm: o.aberta_em, placa: o.placa })),
      },
    };
  });

  router.put("/api/clientes/:id", async ({ params, corpo }) => {
    const id = idParam.parse(params.id);
    const d = clienteEntrada.parse(corpo);
    const { rows } = await db.query(
      `UPDATE clientes SET nome = $2, documento = $3, telefone = $4, email = $5, endereco = $6,
         observacoes = $7, atualizado_em = now()
       WHERE id = $1 RETURNING ${COLUNAS}`,
      [id, d.nome, d.documento, d.telefone, d.email, d.endereco, d.observacoes],
    );
    if (!rows[0]) throw naoEncontrado("Cliente");
    return { json: mapearCliente(rows[0]) };
  });
}
