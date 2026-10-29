import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { idParam } from "../http/esquemas.js";
import { naoEncontrado, type Router } from "../http/router.js";
import { buscarOrdem, type OrdemServico } from "./ordens.js";

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (d: Date | null, fuso = "America/Sao_Paulo") =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: fuso }) : "—";
const dataSimples = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function formatarDocumento(d: string | null): string {
  if (!d) return "—";
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export function htmlOrdem(os: OrdemServico, cfg: Pick<Config, "nomeOficina" | "dadosOficina" | "fusoHorario">): string {
  const linhas = (tipo: "servico" | "peca") =>
    os.itens
      .filter((i) => i.tipo === tipo)
      .map(
        (i) => `<tr><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td class="n">${qtd(i.quantidade)}</td>
          <td class="n">${reais(i.valorUnitarioCentavos)}</td><td class="n">${reais(i.totalCentavos)}</td></tr>`,
      )
      .join("") || `<tr><td colspan="5" class="vazio">Nenhum item</td></tr>`;

  const v = os.veiculo;
  const c = os.cliente;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OS nº ${os.numero} — ${esc(v.placa)}</title>
<link rel="stylesheet" href="/impressao.css">
</head><body>
<div class="acoes"><button type="button" id="imprimir">Imprimir</button> <a href="/#/os/${os.id}">Voltar</a></div>
<header>
  <div><h1>${esc(cfg.nomeOficina)}</h1><p>${esc(cfg.dadosOficina)}</p></div>
  <div class="num"><span>Ordem de Serviço</span><strong>nº ${os.numero}</strong><em>${esc(os.statusRotulo)}</em></div>
</header>
<section class="grade">
  <div><h2>Cliente</h2>
    <p><b>${esc(c.nome)}</b></p>
    <p>CPF/CNPJ: ${formatarDocumento(c.documento)}</p>
    <p>Telefone: ${esc(c.telefone) || "—"}${c.email ? ` · ${esc(c.email)}` : ""}</p>
    <p>${esc(c.endereco)}</p></div>
  <div><h2>Veículo</h2>
    <p><b>${esc(v.placa)}</b> — ${esc(v.marca)} ${esc(v.modelo)}${v.ano ? ` (${v.ano})` : ""}</p>
    <p>Cor: ${esc(v.cor) || "—"} · Combustível: ${esc(v.combustivel) || "—"}</p>
    <p>Chassi: ${esc(v.chassi) || "—"}</p>
    <p>KM na entrada: ${os.kmEntrada != null ? os.kmEntrada.toLocaleString("pt-BR") : "—"}</p></div>
  <div><h2>Datas</h2>
    <p>Abertura: ${data(os.abertaEm, cfg.fusoHorario)}</p>
    <p>Previsão: ${dataSimples(os.previsaoEntrega)}</p>
    <p>Conclusão: ${data(os.concluidaEm, cfg.fusoHorario)}</p>
    <p>Entrega: ${data(os.entregueEm, cfg.fusoHorario)}</p></div>
</section>
<section><h2>Problema relatado</h2><p class="texto">${esc(os.defeitoRelatado)}</p></section>
${os.diagnostico ? `<section><h2>Diagnóstico</h2><p class="texto">${esc(os.diagnostico)}</p></section>` : ""}
<section><h2>Serviços</h2>
<table><thead><tr><th>Cód.</th><th>Descrição</th><th class="n">Qtd/h</th><th class="n">Unitário</th><th class="n">Total</th></tr></thead>
<tbody>${linhas("servico")}</tbody></table></section>
<section><h2>Peças</h2>
<table><thead><tr><th>Cód.</th><th>Descrição</th><th class="n">Qtd</th><th class="n">Unitário</th><th class="n">Total</th></tr></thead>
<tbody>${linhas("peca")}</tbody></table></section>
<section class="totais">
  <p><span>Serviços</span><span>${reais(os.totais.servicosCentavos)}</span></p>
  <p><span>Peças</span><span>${reais(os.totais.pecasCentavos)}</span></p>
  ${os.totais.descontoCentavos ? `<p><span>Desconto</span><span>− ${reais(os.totais.descontoCentavos)}</span></p>` : ""}
  <p class="total"><span>Total</span><span>${reais(os.totais.totalCentavos)}</span></p>
  ${os.formaPagamento ? `<p><span>Pagamento</span><span>${esc(os.formaPagamento)}</span></p>` : ""}
</section>
${os.observacoes ? `<section><h2>Observações</h2><p class="texto">${esc(os.observacoes)}</p></section>` : ""}
<section class="termo">
  <p>Autorizo a execução dos serviços descritos acima. Peças substituídas ficam à disposição do cliente por 30 dias.</p>
  <div class="assinaturas"><div>Assinatura do cliente</div><div>Responsável pela oficina</div></div>
</section>
<script src="/impressao.js"></script>
</body></html>`;
}

export function rotasImpressao(router: Router, db: Db, cfg: Config): void {
  router.get("/ordens/:id/imprimir", async ({ params }) => {
    const os = await buscarOrdem(db, idParam.parse(params.id));
    if (!os) throw naoEncontrado("Ordem de serviço");
    return { html: htmlOrdem(os, cfg) };
  });
}
