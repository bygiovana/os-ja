// Integração: mecânicos, responsável pela OS, anotações, ajuste de valor e tela de conexão.
// Mesmo banco de teste do api.test.ts (apagado a cada execução); os arquivos rodam em sequência.
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

describe("mecânicos e celular", { skip: pular }, () => {
  let db: Db;
  let servidor: Server;
  let base = "";
  const cfg: Config = {
    porta: 7300,
    host: "127.0.0.1",
    databaseUrl: URL_TESTE ?? "",
    nomeOficina: "Oficina Teste",
    dadosOficina: "",
    fusoHorario: "America/Sao_Paulo",
  };

  const api = async (metodo: string, caminho: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, dados: await r.json() };
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

  let joao: { id: number };
  let pedro: { id: number };
  let osId: number;

  it("cadastra mecânicos sem duplicar pelo nome", async () => {
    joao = (await api("POST", "/api/mecanicos", { nome: "João" })).dados;
    pedro = (await api("POST", "/api/mecanicos", { nome: "Pedro Alves" })).dados;
    const repetido = await api("POST", "/api/mecanicos", { nome: "  joão " });
    assert.equal(repetido.status, 201);
    assert.equal(repetido.dados.id, joao.id);
    assert.equal((await api("POST", "/api/mecanicos", { nome: "J" })).status, 400);
    const lista = (await api("GET", "/api/mecanicos")).dados;
    assert.deepEqual(lista.map((m: { nome: string }) => m.nome), ["João", "Pedro Alves"]);
  });

  it("atribui responsável, filtra a fila e registra no histórico", async () => {
    const os = (await api("POST", "/api/ordens", {
      cliente: { nome: "Ana Souza" },
      veiculo: { placa: "MEC1A23", marca: "Fiat", modelo: "Uno" },
      defeitoRelatado: "Embreagem patinando",
    })).dados;
    osId = os.id;
    assert.equal(os.mecanico, null);

    const fila = (await api("GET", "/api/ordens?mecanico=nenhum")).dados.itens;
    assert.equal(fila.length, 1);
    assert.equal(fila[0].defeitoRelatado, "Embreagem patinando");

    const atribuida = (await api("PUT", `/api/ordens/${osId}/mecanico`, { mecanicoId: joao.id })).dados;
    assert.deepEqual(atribuida.mecanico, { id: joao.id, nome: "João" });
    assert.equal(atribuida.eventos.at(-1).detalhe, "Responsável: João");

    assert.equal((await api("GET", "/api/ordens?mecanico=nenhum")).dados.itens.length, 0);
    const doJoao = (await api("GET", `/api/ordens?mecanico=${joao.id}`)).dados.itens;
    assert.equal(doJoao[0].mecanico.nome, "João");
    assert.equal((await api("GET", `/api/ordens?mecanico=${pedro.id}`)).dados.itens.length, 0);
    assert.equal((await api("PUT", `/api/ordens/${osId}/mecanico`, { mecanicoId: 999 })).status, 404);
    assert.equal((await api("GET", "/api/ordens?mecanico=abc")).status, 400);
  });

  it("mecânico desativado não recebe OS nova", async () => {
    await api("PATCH", `/api/mecanicos/${pedro.id}`, { ativo: false });
    assert.equal((await api("GET", "/api/mecanicos")).dados.length, 1);
    assert.equal((await api("GET", "/api/mecanicos?todos=1")).dados.length, 2);
    assert.equal((await api("PUT", `/api/ordens/${osId}/mecanico`, { mecanicoId: pedro.id })).status, 404);
    await api("PATCH", `/api/mecanicos/${pedro.id}`, { ativo: true });
  });

  it("guarda anotações do mecânico e do escritório", async () => {
    const r = await api("POST", `/api/ordens/${osId}/notas`, { mecanicoId: joao.id, texto: "Disco de embreagem gasto" });
    assert.equal(r.status, 201);
    await api("POST", `/api/ordens/${osId}/notas`, { texto: "Cliente autorizou" });
    const os = (await api("GET", `/api/ordens/${osId}`)).dados;
    assert.deepEqual(os.notas.map((n: { autor: string }) => n.autor), ["João", "Escritório"]);
    assert.equal((await api("POST", `/api/ordens/${osId}/notas`, { texto: "  " })).status, 400);
  });

  it("mecânico lança peça sem valor e o escritório precifica depois de concluída", async () => {
    let os = (await api("POST", `/api/ordens/${osId}/itens`, {
      tipo: "peca", descricao: "Kit embreagem", quantidade: 1, valorUnitarioCentavos: 0,
    })).dados;
    const item = os.itens[0];
    for (const s of ["aprovada", "em_andamento", "concluida"]) {
      assert.equal((await api("POST", `/api/ordens/${osId}/status`, { status: s })).status, 200, s);
    }
    // adicionar continua bloqueado, mas ajustar o preço é permitido na concluída
    assert.equal((await api("POST", `/api/ordens/${osId}/itens`, {
      tipo: "peca", descricao: "x", quantidade: 1, valorUnitarioCentavos: 1,
    })).status, 409);
    os = (await api("PATCH", `/api/ordens/${osId}/itens/${item.id}`, { valorUnitarioCentavos: 89000 })).dados;
    assert.equal(os.totais.totalCentavos, 89000);
    assert.equal(os.eventos.at(-1).tipo, "item_alterado");
    assert.equal((await api("PATCH", `/api/ordens/${osId}/itens/99999`, { valorUnitarioCentavos: 1 })).status, 404);

    await api("POST", `/api/ordens/${osId}/status`, { status: "entregue" });
    assert.equal((await api("PATCH", `/api/ordens/${osId}/itens/${item.id}`, { valorUnitarioCentavos: 1 })).status, 409);
    assert.equal((await api("POST", `/api/ordens/${osId}/notas`, { texto: "tarde demais" })).status, 409);
    assert.equal((await api("PUT", `/api/ordens/${osId}/mecanico`, { mecanicoId: null })).status, 409);
  });

  it("conta carros em aberto por mecânico", async () => {
    const os = (await api("POST", "/api/ordens", {
      cliente: { nome: "Bia" }, veiculo: { placa: "MEC2B34", marca: "Ford", modelo: "Ka" },
      defeitoRelatado: "Revisão", itens: [{ tipo: "servico", descricao: "Revisão", quantidade: 1, valorUnitarioCentavos: 1 }],
    })).dados;
    await api("PUT", `/api/ordens/${os.id}/mecanico`, { mecanicoId: pedro.id });
    await api("POST", `/api/ordens/${os.id}/status`, { status: "aprovada" });
    const lista = (await api("GET", "/api/mecanicos")).dados;
    assert.equal(lista.find((m: { id: number }) => m.id === pedro.id).emAberto, 1);
    assert.equal(lista.find((m: { id: number }) => m.id === joao.id).emAberto, 0);
  });

  it("informa se os celulares conseguem acessar", async () => {
    const local = (await api("GET", "/api/conexao")).dados;
    assert.deepEqual(local, { acessoRede: false, loginAtivo: false, porta: 7300, enderecos: [] });

    const rede = criarApp(db, { ...cfg, host: "0.0.0.0", usuario: "u", senha: "s" }).listen(0);
    await new Promise((r) => rede.once("listening", r));
    try {
      const url = `http://127.0.0.1:${(rede.address() as AddressInfo).port}`;
      const auth = { authorization: `Basic ${Buffer.from("u:s").toString("base64")}` };
      const dados = await (await fetch(url + "/api/conexao", { headers: auth })).json();
      assert.equal(dados.acessoRede, true);
      assert.equal(dados.loginAtivo, true);
      for (const e of dados.enderecos) assert.match(e, /^http:\/\/\d+\.\d+\.\d+\.\d+:7300\/#\/m$/);
      // o celular busca o ícone e o manifesto antes de pedir a senha
      assert.equal((await fetch(url + "/manifest.webmanifest")).status, 200);
      assert.equal((await fetch(url + "/icones/icone-192.png")).status, 200);
      assert.equal((await fetch(url + "/sw.js")).status, 401);
      assert.equal((await fetch(url + "/api/mecanicos")).status, 401);
    } finally {
      await new Promise((r) => rede.close(r));
    }
  });
});
