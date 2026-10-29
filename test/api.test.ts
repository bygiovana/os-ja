// Testes de integração contra um Postgres real.
// Rode com: DATABASE_URL_TEST=postgres://usuario:senha@localhost:5432/oficina_test npm test
// ATENÇÃO: o banco de teste é apagado a cada execução.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { migrar } from "../src/db/migrate.js";
import { criarPool, type Db } from "../src/db/pool.js";

const URL_TESTE = process.env.DATABASE_URL_TEST;
const pular = URL_TESTE ? false : "defina DATABASE_URL_TEST para rodar os testes de integração";

const CPF = "529.982.247-25";

function novaOs(extra: Record<string, unknown> = {}) {
  return {
    cliente: { nome: "Maria da Silva", documento: CPF, telefone: "(16) 99999-1234", email: "Maria@Exemplo.com" },
    veiculo: { placa: "bra-2e19", marca: "Volkswagen", modelo: "Gol 1.0", ano: 2018, cor: "Prata", kmAtual: 85000 },
    kmEntrada: 85320,
    defeitoRelatado: "Barulho na suspensão dianteira e luz da injeção acesa",
    previsaoEntrega: "2026-11-05",
    itens: [
      { tipo: "servico", descricao: "Diagnóstico com scanner", quantidade: 1, valorUnitarioCentavos: 15000 },
      { tipo: "peca", codigo: "AMORT-D", descricao: "Amortecedor dianteiro", quantidade: 2, valorUnitarioCentavos: 28990 },
    ],
    ...extra,
  };
}

describe("API de ordens de serviço", { skip: pular }, () => {
  let db: Db;
  let servidor: Server;
  let base = "";
  const cfg: Config = {
    porta: 0,
    host: "127.0.0.1",
    databaseUrl: URL_TESTE ?? "",
    nomeOficina: "Oficina Teste",
    dadosOficina: "Rua A, 100 — Ribeirão Preto/SP",
    fusoHorario: "America/Sao_Paulo",
  };

  const api = async (metodo: string, caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { "content-type": "application/json", ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const tipo = r.headers.get("content-type") ?? "";
    const dados = tipo.includes("json") ? await r.json() : await r.text();
    return { status: r.status, dados };
  };

  before(async () => {
    db = criarPool(URL_TESTE!);
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrar(db, () => {});
    servidor = criarApp(db, cfg).listen(0);
    await new Promise((r) => servidor.once("listening", r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((r) => servidor.close(r));
    await db.end();
  });

  it("responde à verificação de saúde e aplica migrações só uma vez", async () => {
    assert.deepEqual((await api("GET", "/api/saude")).dados, { ok: true });
    assert.deepEqual(await migrar(db, () => {}), []);
  });

  it("abre a OS cadastrando cliente e veículo, com totais e dados copiados para o pedido", async () => {
    const { status, dados: os } = await api("POST", "/api/ordens", novaOs());
    assert.equal(status, 201);
    assert.equal(os.numero, 1);
    assert.equal(os.status, "orcamento");
    assert.equal(os.cliente.nome, "Maria da Silva");
    assert.equal(os.cliente.documento, "52998224725");
    assert.equal(os.cliente.email, "maria@exemplo.com");
    assert.equal(os.veiculo.placa, "BRA2E19");
    assert.equal(os.kmEntrada, 85320);
    assert.equal(os.previsaoEntrega, "2026-11-05");
    assert.equal(os.totais.servicosCentavos, 15000);
    assert.equal(os.totais.pecasCentavos, 57980);
    assert.equal(os.totais.totalCentavos, 72980);
    assert.equal(os.itens.length, 2);
    assert.equal(os.eventos[0].tipo, "aberta");
    assert.deepEqual(os.proximosStatus.map((p: { status: string }) => p.status), ["aprovada", "cancelada"]);

    const veiculo = (await api("GET", "/api/veiculos?placa=BRA-2E19")).dados;
    assert.equal(veiculo.kmAtual, 85320, "km do veículo atualizado pela entrada");
    assert.equal(veiculo.cliente.nome, "Maria da Silva");
  });

  it("reaproveita cliente (CPF) e veículo (placa) já cadastrados sem reduzir a quilometragem", async () => {
    const { status, dados: os } = await api(
      "POST",
      "/api/ordens",
      novaOs({
        cliente: { nome: "Maria da Silva Souza", documento: "52998224725", telefone: "16 98888-0000" },
        veiculo: { placa: "BRA2E19", marca: "Volkswagen", modelo: "Gol 1.0", kmAtual: 1000 },
        kmEntrada: null,
        itens: [],
      }),
    );
    assert.equal(status, 201);
    assert.equal(os.numero, 2);
    const contagem = await db.query("SELECT (SELECT count(*) FROM clientes)::int AS c, (SELECT count(*) FROM veiculos)::int AS v");
    assert.deepEqual(contagem.rows[0], { c: 1, v: 1 });
    const cliente = (await api("GET", `/api/clientes/${os.clienteId}`)).dados;
    assert.equal(cliente.nome, "Maria da Silva Souza");
    assert.equal(cliente.telefone, "16 98888-0000");
    assert.equal(cliente.email, "maria@exemplo.com", "e-mail não informado é mantido");
    assert.equal(cliente.veiculos[0].kmAtual, 85320, "km nunca diminui");
    assert.equal(cliente.ordens.length, 2);
    // a OS 1 guardou o nome antigo: o pedido não muda quando o cadastro muda
    const os1 = (await api("GET", "/api/ordens/1")).dados;
    assert.equal(os1.cliente.nome, "Maria da Silva");
  });

  it("abre OS por id de cliente e veículo, e recusa veículo de outro cliente", async () => {
    const outro = await api("POST", "/api/clientes", { nome: "João Pereira", telefone: "16 3333-4444" });
    assert.equal(outro.status, 201);
    const ok = await api("POST", "/api/ordens", {
      cliente: { id: 1 }, veiculo: { id: 1 }, defeitoRelatado: "Revisão dos 90 mil km",
    });
    assert.equal(ok.status, 201);
    const errado = await api("POST", "/api/ordens", {
      cliente: { id: outro.dados.id }, veiculo: { id: 1 }, defeitoRelatado: "Troca de óleo",
    });
    assert.equal(errado.status, 400);
    assert.match(errado.dados.erro, /outro cliente/);
    const inexistente = await api("POST", "/api/ordens", {
      cliente: { id: 999 }, veiculo: { id: 1 }, defeitoRelatado: "Troca de óleo",
    });
    assert.equal(inexistente.status, 404);
  });

  it("valida CPF, placa e campos obrigatórios com mensagens em português", async () => {
    const r = await api("POST", "/api/ordens", novaOs({
      cliente: { nome: "Ana", documento: "123.456.789-00" },
      veiculo: { placa: "XX-12", marca: "Fiat", modelo: "Uno" },
      defeitoRelatado: "",
    }));
    assert.equal(r.status, 400);
    assert.match(r.dados.erro, /cliente\.documento: CPF ou CNPJ inválido/);
    assert.match(r.dados.erro, /veiculo\.placa: placa inválida/);
    assert.match(r.dados.erro, /defeitoRelatado/);
    assert.equal((await api("POST", "/api/ordens", "não é objeto")).status, 400);
    const jsonQuebrado = await fetch(base + "/api/ordens", { method: "POST", body: "{quebrado" });
    assert.equal(jsonQuebrado.status, 400);
    const duplicado = await api("POST", "/api/clientes", { nome: "Outra", documento: CPF });
    assert.equal(duplicado.status, 409);
  });

  it("percorre o fluxo de status e bloqueia alterações indevidas", async () => {
    const { dados: os } = await api("POST", "/api/ordens", novaOs({ cliente: { id: 1 }, veiculo: { id: 1 } }));
    const id = os.id;

    assert.equal((await api("POST", `/api/ordens/${id}/status`, { status: "concluida" })).status, 409);
    assert.equal((await api("POST", `/api/ordens/${id}/status`, { status: "aprovada" })).dados.status, "aprovada");
    assert.equal((await api("POST", `/api/ordens/${id}/status`, { status: "em_andamento" })).status, 200);

    const comItem = await api("POST", `/api/ordens/${id}/itens`, {
      tipo: "servico", descricao: "Mão de obra suspensão", quantidade: 2.5, valorUnitarioCentavos: 12000,
    });
    assert.equal(comItem.status, 201);
    assert.equal(comItem.dados.totais.servicosCentavos, 15000 + 30000);
    const itemId = comItem.dados.itens.find((i: { descricao: string }) => i.descricao === "Mão de obra suspensão").id;

    const removido = await api("DELETE", `/api/ordens/${id}/itens/${itemId}`);
    assert.equal(removido.dados.itens.length, 2);
    assert.equal((await api("DELETE", `/api/ordens/${id}/itens/${itemId}`)).status, 404);

    const desconto = await api("PATCH", `/api/ordens/${id}`, {
      descontoCentavos: 2980, diagnostico: "Amortecedores com vazamento", formaPagamento: "PIX",
    });
    assert.equal(desconto.dados.totais.totalCentavos, 70000);
    assert.equal(desconto.dados.diagnostico, "Amortecedores com vazamento");

    assert.equal((await api("POST", `/api/ordens/${id}/status`, { status: "concluida" })).dados.status, "concluida");
    const travada = await api("POST", `/api/ordens/${id}/itens`, {
      tipo: "peca", descricao: "Parafuso", quantidade: 1, valorUnitarioCentavos: 100,
    });
    assert.equal(travada.status, 409);
    assert.equal((await api("PATCH", `/api/ordens/${id}`, { descontoCentavos: 0 })).status, 409);

    // duas entregas simultâneas: só uma pode valer
    const [a, b] = await Promise.all([
      api("POST", `/api/ordens/${id}/status`, { status: "entregue" }),
      api("POST", `/api/ordens/${id}/status`, { status: "entregue" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);

    const final = (await api("GET", `/api/ordens/${id}`)).dados;
    assert.equal(final.status, "entregue");
    assert.ok(final.aprovadaEm && final.concluidaEm && final.entregueEm);
    assert.deepEqual(final.proximosStatus, []);
    assert.equal(final.eventos.filter((e: { tipo: string }) => e.tipo === "status").length, 4);
    assert.equal((await api("PATCH", `/api/ordens/${id}`, { observacoes: "x" })).status, 409);
  });

  it("exige itens para aprovar e motivo para cancelar", async () => {
    const vazia = (await api("POST", "/api/ordens", {
      cliente: { id: 1 }, veiculo: { id: 1 }, defeitoRelatado: "Ar-condicionado não gela",
    })).dados;
    const aprovar = await api("POST", `/api/ordens/${vazia.id}/status`, { status: "aprovada" });
    assert.equal(aprovar.status, 400);
    assert.match(aprovar.dados.erro, /pelo menos um/);
    assert.equal((await api("POST", `/api/ordens/${vazia.id}/status`, { status: "cancelada" })).status, 400);
    const cancelada = await api("POST", `/api/ordens/${vazia.id}/status`, { status: "cancelada", motivo: "Cliente desistiu" });
    assert.equal(cancelada.dados.motivoCancelamento, "Cliente desistiu");
  });

  it("lista, busca e pagina as OS", async () => {
    const todas = (await api("GET", "/api/ordens")).dados;
    assert.ok(todas.itens.length >= 5);
    assert.ok(todas.itens[0].numero > todas.itens[1].numero, "mais recentes primeiro");
    assert.equal(typeof todas.itens[0].totalCentavos, "number");

    const porPlaca = (await api("GET", "/api/ordens?busca=bra-2e")).dados.itens;
    assert.equal(porPlaca.length, todas.itens.length);
    assert.equal((await api("GET", "/api/ordens?busca=1")).dados.itens.some((o: { numero: number }) => o.numero === 1), true);
    assert.equal((await api("GET", "/api/ordens?busca=Silva")).dados.itens.length, todas.itens.length);
    assert.equal((await api("GET", "/api/ordens?busca=ninguem%25")).dados.itens.length, 0);

    const entregues = (await api("GET", "/api/ordens?status=entregue")).dados.itens;
    assert.equal(entregues.length, 1);
    assert.equal(entregues[0].totalCentavos, 70000);
    assert.equal((await api("GET", "/api/ordens?status=inexistente")).status, 400);

    const p1 = (await api("GET", "/api/ordens?limite=2")).dados;
    assert.equal(p1.itens.length, 2);
    const p2 = (await api("GET", `/api/ordens?limite=2&antesDe=${p1.proximo}`)).dados;
    assert.ok(p2.itens[0].numero < p1.itens[1].numero);
  });

  it("calcula o resumo do mês", async () => {
    const r = (await api("GET", "/api/resumo")).dados;
    assert.equal(r.mes.entregues, 1);
    assert.equal(r.mes.faturamentoCentavos, 70000);
    assert.equal(r.mes.ticketMedioCentavos, 70000);
    assert.equal(r.porStatus.cancelada, 1);
    assert.equal(r.porStatus.entregue, 1);
  });

  it("gera a OS para impressão escapando o conteúdo digitado", async () => {
    const { dados: os } = await api("POST", "/api/ordens", novaOs({
      cliente: { nome: "<script>alert(1)</script> Cliente", telefone: "16 1111-2222" },
      veiculo: { placa: "ABC1234", marca: "Fiat", modelo: "Uno" },
    }));
    const pagina = await api("GET", `/ordens/${os.id}/imprimir`);
    assert.equal(pagina.status, 200);
    assert.match(pagina.dados, /Oficina Teste/);
    assert.match(pagina.dados, new RegExp(`nº ${os.numero}`));
    assert.match(pagina.dados, /ABC1234/);
    assert.match(pagina.dados, /R\$\s?729,80/);
    assert.ok(!pagina.dados.includes("<script>alert(1)"));
    assert.ok(pagina.dados.includes("&lt;script&gt;"));
  });

  it("serve a interface e bloqueia acesso fora da pasta pública", async () => {
    const index = await fetch(base + "/");
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.equal((await fetch(base + "/..%2fpackage.json")).status, 404);
    assert.equal((await fetch(base + "/api/nada")).status, 404);
    assert.equal((await fetch(base + "/api/ordens/1", { method: "PUT" })).status, 405);
  });

  it("exige usuário e senha quando configurados", async () => {
    const protegido = criarApp(db, { ...cfg, usuario: "oficina", senha: "s3nh@:forte" }).listen(0);
    await new Promise((r) => protegido.once("listening", r));
    const url = `http://127.0.0.1:${(protegido.address() as AddressInfo).port}`;
    try {
      assert.equal((await fetch(url + "/api/ordens")).status, 401);
      assert.equal((await fetch(url + "/api/saude")).status, 200);
      const errada = Buffer.from("oficina:errada").toString("base64");
      assert.equal((await fetch(url + "/api/ordens", { headers: { authorization: `Basic ${errada}` } })).status, 401);
      const certa = Buffer.from("oficina:s3nh@:forte").toString("base64");
      assert.equal((await fetch(url + "/api/ordens", { headers: { authorization: `Basic ${certa}` } })).status, 200);
    } finally {
      await new Promise((r) => protegido.close(r));
    }
  });
});
