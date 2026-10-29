import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularTotais,
  cnpjValido,
  cpfValido,
  documentoValido,
  normalizarPlaca,
  placaValida,
  podeTransicionar,
  validarTransicao,
  TransicaoInvalidaError,
} from "../src/domain/ordem-servico.js";

describe("status da OS", () => {
  it("segue o fluxo normal orçamento → entregue", () => {
    assert.equal(podeTransicionar("orcamento", "aprovada"), true);
    assert.equal(podeTransicionar("aprovada", "em_andamento"), true);
    assert.equal(podeTransicionar("em_andamento", "concluida"), true);
    assert.equal(podeTransicionar("concluida", "entregue"), true);
  });

  it("bloqueia pulos e mudanças após entrega ou cancelamento", () => {
    assert.equal(podeTransicionar("orcamento", "concluida"), false);
    assert.equal(podeTransicionar("entregue", "em_andamento"), false);
    assert.equal(podeTransicionar("cancelada", "orcamento"), false);
    assert.throws(() => validarTransicao("orcamento", "entregue"), TransicaoInvalidaError);
  });

  it("exige motivo para cancelar", () => {
    assert.throws(() => validarTransicao("aprovada", "cancelada"), /motivo/);
    assert.doesNotThrow(() => validarTransicao("aprovada", "cancelada", "cliente desistiu"));
  });

  it("permite voltar de concluída para em andamento (retrabalho)", () => {
    assert.equal(podeTransicionar("concluida", "em_andamento"), true);
  });
});

describe("totais", () => {
  it("soma serviços e peças separadamente em centavos", () => {
    const t = calcularTotais(
      [
        { tipo: "servico", quantidade: 1.5, valorUnitarioCentavos: 12000 }, // 1,5 h × R$ 120
        { tipo: "peca", quantidade: 4, valorUnitarioCentavos: 3990 }, // 4 L de óleo
        { tipo: "peca", quantidade: 1, valorUnitarioCentavos: 4500 }, // filtro
      ],
      1000,
    );
    assert.equal(t.servicosCentavos, 18000);
    assert.equal(t.pecasCentavos, 20460);
    assert.equal(t.subtotalCentavos, 38460);
    assert.equal(t.totalCentavos, 37460);
  });

  it("nunca deixa o desconto passar do subtotal nem ficar negativo", () => {
    const itens = [{ tipo: "servico" as const, quantidade: 1, valorUnitarioCentavos: 5000 }];
    assert.equal(calcularTotais(itens, 999999).totalCentavos, 0);
    assert.equal(calcularTotais(itens, -500).totalCentavos, 5000);
  });
});

describe("validações brasileiras", () => {
  it("aceita placa antiga e Mercosul, com ou sem hífen", () => {
    assert.equal(placaValida("abc-1234"), true);
    assert.equal(placaValida("BRA2E19"), true);
    assert.equal(placaValida("AB12345"), false);
    assert.equal(normalizarPlaca("bra-2e19"), "BRA2E19");
  });

  it("valida CPF e CNPJ pelos dígitos verificadores", () => {
    assert.equal(cpfValido("529.982.247-25"), true);
    assert.equal(cpfValido("529.982.247-26"), false);
    assert.equal(cpfValido("111.111.111-11"), false);
    assert.equal(cnpjValido("11.222.333/0001-81"), true);
    assert.equal(cnpjValido("11.222.333/0001-80"), false);
    assert.equal(documentoValido("52998224725"), true);
    assert.equal(documentoValido("123"), false);
  });
});
