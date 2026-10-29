// Interface da Gestão de OS — JavaScript puro, sem build.
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const conteudo = $("#conteudo");

const STATUS = {
  orcamento: "Orçamento",
  aprovada: "Aprovada",
  em_andamento: "Em andamento",
  aguardando_peca: "Aguardando peça",
  concluida: "Concluída",
  entregue: "Entregue",
  cancelada: "Cancelada",
};

// ---------- utilitários ----------
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reais = (c) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const dataCurta = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
const dataIso = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const qtd = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const statusHtml = (s) => `<span class="status ${esc(s)}">${esc(STATUS[s] ?? s)}</span>`;
const placaHtml = (p, grande = false) => `<span class="placa${grande ? " grande" : ""}">${esc(formatarPlaca(p))}</span>`;
const formatarPlaca = (p) => (p && /^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p ?? "");

function formatarDocumento(d) {
  if (!d) return "—";
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

/** "1.234,56" | "1234.56" | "35" → centavos */
function paraCentavos(texto) {
  let t = String(texto ?? "").replace(/[R$\s]/g, "");
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido: ${texto}`);
  return Math.round(n * 100);
}
const paraNumero = (texto) => Number(String(texto ?? "").replace(/\./g, "").replace(",", "."));

let timerAviso;
function avisar(msg, erro = false) {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = `visivel${erro ? " erro" : ""}`;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.className = ""), erro ? 6000 : 3000);
}

async function api(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: corpo ? { "content-type": "application/json" } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(dados?.erro ?? `Erro ${r.status}`);
  return dados;
}

/** Executa uma ação de botão com estado de carregamento e aviso de erro. */
async function acao(botao, fn) {
  if (botao) botao.disabled = true;
  try {
    await fn();
  } catch (e) {
    avisar(e.message, true);
  } finally {
    if (botao && botao.isConnected) botao.disabled = false;
  }
}

function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function perguntar(titulo, rotulo) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog">
      <h2>${esc(titulo)}</h2>
      <label>${esc(rotulo)}<textarea name="r" required></textarea></label>
      <div class="acoes"><button value="cancelar" formnovalidate>Voltar</button><button class="primario" value="ok">Confirmar</button></div>
    </form>`;
    document.body.append(d);
    d.addEventListener("close", () => {
      resolve(d.returnValue === "ok" ? $("textarea", d).value.trim() : null);
      d.remove();
    });
    d.showModal();
  });
}

// ---------- rotas ----------
const rotas = [
  [/^#?\/?$/, telaPainel, "painel"],
  [/^#\/nova$/, telaNovaOs, "painel"],
  [/^#\/os\/(\d+)$/, telaOs, "painel"],
  [/^#\/clientes$/, telaClientes, "clientes"],
  [/^#\/clientes\/(\d+)$/, telaCliente, "clientes"],
];

async function navegar() {
  const hash = location.hash || "#/";
  for (const [padrao, tela, nav] of rotas) {
    const m = padrao.exec(hash);
    if (!m) continue;
    $$("[data-nav]").forEach((a) => a.classList.toggle("ativo", a.dataset.nav === nav));
    conteudo.innerHTML = `<p class="carregando">Carregando…</p>`;
    try {
      await tela(...m.slice(1));
    } catch (e) {
      conteudo.innerHTML = `<div class="cartao vazio">${esc(e.message)}<br><br><a href="#/">Voltar ao painel</a></div>`;
    }
    conteudo.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", navegar);

// ---------- painel ----------
const filtroPainel = { status: "abertas", busca: "" };
const GRUPOS = {
  abertas: ["orcamento", "aprovada", "em_andamento", "aguardando_peca"],
  concluida: ["concluida"],
  entregue: ["entregue"],
  cancelada: ["cancelada"],
  todas: [],
};

async function telaPainel() {
  const resumo = await api("GET", "/api/resumo");
  conteudo.innerHTML = `
    <div class="cabecalho">
      <div><h1>Ordens de serviço</h1><p class="subtitulo">Acompanhe os carros na oficina, do orçamento à entrega.</p></div>
      <a class="botao primario" href="#/nova">+ Nova OS</a>
    </div>
    <section class="indicadores">
      <div class="indicador"><span>Em aberto</span><strong>${resumo.abertas}</strong><small>${resumo.porStatus.em_andamento} em andamento</small></div>
      <div class="indicador"><span>Prontas p/ entrega</span><strong>${resumo.prontasParaEntrega}</strong><small>aguardando o cliente</small></div>
      <div class="indicador ${resumo.atrasadas ? "alerta" : ""}"><span>Atrasadas</span><strong>${resumo.atrasadas}</strong><small>passaram da previsão</small></div>
      <div class="indicador"><span>Faturado no mês</span><strong>${reais(resumo.mes.faturamentoCentavos)}</strong><small>${resumo.mes.entregues} entregue(s) · ticket ${reais(resumo.mes.ticketMedioCentavos)}</small></div>
    </section>
    <div class="filtros">
      <input type="search" id="busca" placeholder="Buscar por nº, placa ou cliente" value="${esc(filtroPainel.busca)}" aria-label="Buscar ordens">
      ${Object.entries({ abertas: "Em aberto", concluida: "Prontas", entregue: "Entregues", cancelada: "Canceladas", todas: "Todas" })
        .map(([k, v]) => `<button class="chip" data-grupo="${k}" aria-pressed="${filtroPainel.status === k}">${v}</button>`)
        .join("")}
    </div>
    <div class="cartao tabela-rolagem" id="lista"></div>`;

  const carregar = async (antesDe) => {
    const p = new URLSearchParams({ limite: "30" });
    const grupo = GRUPOS[filtroPainel.status];
    if (grupo.length) p.set("status", grupo.join(","));
    if (filtroPainel.busca) p.set("busca", filtroPainel.busca);
    if (antesDe) p.set("antesDe", antesDe);
    const { itens, proximo } = await api("GET", `/api/ordens?${p}`);
    renderLista(itens, proximo, Boolean(antesDe), carregar);
  };

  $("#busca").addEventListener("input", debounce((e) => {
    filtroPainel.busca = e.target.value.trim();
    carregar().catch((er) => avisar(er.message, true));
  }));
  $$("[data-grupo]").forEach((b) =>
    b.addEventListener("click", () => {
      filtroPainel.status = b.dataset.grupo;
      $$("[data-grupo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      carregar().catch((er) => avisar(er.message, true));
    }),
  );
  await carregar();
}

function renderLista(itens, proximo, acrescentar, carregar) {
  const lista = $("#lista");
  if (!lista) return; // resposta chegou depois de trocar de tela
  const hoje = hojeIso();
  const linhas = itens
    .map((o) => {
      const atrasada = o.previsaoEntrega && o.previsaoEntrega < hoje && GRUPOS.abertas.includes(o.status);
      return `<tr class="clicavel" data-id="${o.id}" tabindex="0">
        <td class="numero-os">${o.numero}</td>
        <td>${placaHtml(o.placa)}<div class="secundario">${esc(o.veiculo)}</div></td>
        <td>${esc(o.clienteNome)}<div class="secundario">${esc(o.telefone ?? "")}</div></td>
        <td>${statusHtml(o.status)}</td>
        <td class="esconder-celular">${dataCurta(o.abertaEm)}</td>
        <td class="esconder-celular ${atrasada ? "atrasada" : ""}">${dataIso(o.previsaoEntrega)}</td>
        <td class="n">${reais(o.totalCentavos)}</td>
      </tr>`;
    })
    .join("");

  if (!acrescentar) {
    lista.innerHTML = `<table class="tabela">
      <thead><tr><th>Nº</th><th>Veículo</th><th>Cliente</th><th>Status</th><th class="esconder-celular">Abertura</th><th class="esconder-celular">Previsão</th><th class="n">Total</th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="7" class="vazio">Nenhuma ordem encontrada.</td></tr>`}</tbody></table>
      <div class="mais"></div>`;
    $("tbody", lista).addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) location.hash = `#/os/${tr.dataset.id}`;
    });
    $("tbody", lista).addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr && e.key === "Enter") location.hash = `#/os/${tr.dataset.id}`;
    });
  } else {
    $("tbody", lista).insertAdjacentHTML("beforeend", linhas);
  }
  const mais = $(".mais", lista);
  mais.innerHTML = proximo ? `<button type="button">Carregar mais</button>` : "";
  if (proximo) $("button", mais).addEventListener("click", (e) => acao(e.target, () => carregar(proximo)));
}

// ---------- nova OS ----------
async function telaNovaOs() {
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Nova ordem de serviço</h1>
      <p class="subtitulo">Digite a placa: se o carro já veio antes, os dados do cliente e do veículo são preenchidos.</p></div></div>
    <form id="form-os" class="pilha" novalidate>
      <section class="cartao">
        <h3>Veículo</h3>
        <div class="grade c4">
          <label class="obrigatorio">Placa<input name="placa" required maxlength="8" autocomplete="off" placeholder="ABC1D23" autofocus></label>
          <label class="obrigatorio">Marca<input name="marca" required maxlength="80"></label>
          <label class="obrigatorio">Modelo<input name="modelo" required maxlength="120"></label>
          <label>Ano<input name="ano" inputmode="numeric" maxlength="4"></label>
          <label>Cor<input name="cor" maxlength="40"></label>
          <label>Combustível<select name="combustivel"><option value=""></option><option>Flex</option><option>Gasolina</option><option>Etanol</option><option>Diesel</option><option>GNV</option><option>Elétrico</option><option>Híbrido</option></select></label>
          <label class="ocupa-2">Chassi<input name="chassi" maxlength="30"></label>
        </div>
        <div id="encontrado"></div>
      </section>
      <section class="cartao">
        <h3>Cliente</h3>
        <div class="grade c3">
          <label class="obrigatorio">Nome<input name="nome" required maxlength="200"></label>
          <label>CPF ou CNPJ<input name="documento" inputmode="numeric" maxlength="18"></label>
          <label>Telefone / WhatsApp<input name="telefone" type="tel" maxlength="30"></label>
          <label>E-mail<input name="email" type="email" maxlength="200"></label>
          <label class="ocupa-2">Endereço<input name="endereco" maxlength="300"></label>
        </div>
      </section>
      <section class="cartao">
        <h3>Atendimento</h3>
        <div class="grade c3">
          <label>KM de entrada<input name="kmEntrada" inputmode="numeric"></label>
          <label>Previsão de entrega<input name="previsaoEntrega" type="date" min="${hojeIso()}"></label>
          <span></span>
          <label class="ocupa-tudo obrigatorio">Problema relatado pelo cliente<textarea name="defeitoRelatado" required maxlength="2000"></textarea></label>
          <label class="ocupa-tudo">Observações (objetos no carro, avarias, nível de combustível…)<textarea name="observacoes" maxlength="500"></textarea></label>
        </div>
      </section>
      <section class="cartao">
        <h3>Orçamento inicial (opcional)</h3>
        <div class="tabela-rolagem"><table class="tabela" id="itens-novos"><tbody></tbody></table></div>
        ${formItemHtml()}
      </section>
      <div class="rodape-form">
        <span class="total-previa" id="total-previa"></span>
        <a class="botao" href="#/">Cancelar</a>
        <button class="primario" type="submit">Abrir OS</button>
      </div>
    </form>`;

  const form = $("#form-os");
  const itens = [];
  let clienteExistente = null; // { id, nome } do dono encontrado pela placa

  const renderItens = () => {
    $("#itens-novos tbody").innerHTML = itens
      .map((i, n) => `<tr><td><span class="tipo-item ${i.tipo}">${i.tipo === "servico" ? "Serviço" : "Peça"}</span></td>
        <td>${esc(i.descricao)}</td><td class="n">${qtd(i.quantidade)} × ${reais(i.valorUnitarioCentavos)}</td>
        <td class="n">${reais(Math.round(i.quantidade * i.valorUnitarioCentavos))}</td>
        <td class="n"><button type="button" class="discreto" data-remover="${n}" aria-label="Remover item">✕</button></td></tr>`)
      .join("");
    const total = itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitarioCentavos), 0);
    $("#total-previa").textContent = itens.length ? `Total: ${reais(total)}` : "";
  };
  $("#itens-novos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remover]");
    if (b) { itens.splice(Number(b.dataset.remover), 1); renderItens(); }
  });
  ligarFormItem(form, (item) => { itens.push(item); renderItens(); });

  // Autopreenchimento pela placa
  const campo = (n) => form.elements[n];
  campo("placa").addEventListener("input", debounce(async () => {
    const placa = campo("placa").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (placa.length !== 7) return;
    const v = await api("GET", `/api/veiculos?placa=${placa}`).catch(() => null);
    const aviso = $("#encontrado");
    if (!aviso || !form.isConnected) return; // usuário já saiu da tela
    if (!v) { aviso.innerHTML = ""; clienteExistente = null; return; }
    for (const k of ["marca", "modelo", "ano", "cor", "combustivel", "chassi"]) if (v[k] != null) campo(k).value = v[k];
    const c = v.cliente;
    if (c) {
      clienteExistente = { id: c.id, nome: c.nome };
      campo("nome").value = c.nome ?? "";
      campo("documento").value = c.documento ? formatarDocumento(c.documento) : "";
      campo("telefone").value = c.telefone ?? "";
      campo("email").value = c.email ?? "";
      campo("endereco").value = c.endereco ?? "";
    }
    aviso.innerHTML = `<div class="encontrado">Veículo já cadastrado${c ? ` para <b>${esc(c.nome)}</b>` : ""}${v.kmAtual != null ? ` · último KM registrado: ${v.kmAtual.toLocaleString("pt-BR")}` : ""}. Confira os dados abaixo.</div>`;
  }, 400));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const b = $("button[type=submit]", form);
    acao(b, async () => {
      for (const n of ["placa", "marca", "modelo", "nome", "defeitoRelatado"]) {
        if (!campo(n).value.trim()) { campo(n).focus(); throw new Error("Preencha os campos obrigatórios (*)."); }
      }
      const v = (n) => campo(n).value.trim() || null;
      const nomeCliente = v("nome");
      const docDigitos = (v("documento") ?? "").replace(/\D/g, "");
      const corpo = {
        // sem CPF, o dono encontrado pela placa é reaproveitado pelo id (se o nome não mudou) para não duplicar o cadastro
        cliente: !docDigitos && clienteExistente && clienteExistente.nome === nomeCliente ? { id: clienteExistente.id } : {
          nome: nomeCliente, documento: docDigitos || null, telefone: v("telefone"), email: v("email"), endereco: v("endereco"),
        },
        veiculo: {
          placa: v("placa"), marca: v("marca"), modelo: v("modelo"), ano: v("ano") ? Number(v("ano")) : null,
          cor: v("cor"), combustivel: v("combustivel"), chassi: v("chassi"),
          kmAtual: v("kmEntrada") ? paraNumero(v("kmEntrada")) : null,
        },
        kmEntrada: v("kmEntrada") ? paraNumero(v("kmEntrada")) : null,
        defeitoRelatado: v("defeitoRelatado"),
        observacoes: v("observacoes"),
        previsaoEntrega: v("previsaoEntrega"),
        itens,
      };
      const os = await api("POST", "/api/ordens", corpo);
      avisar(`OS nº ${os.numero} aberta.`);
      location.hash = `#/os/${os.id}`;
    });
  });
}

function formItemHtml() {
  return `<div class="form-item" data-form-item>
    <label>Tipo<select name="itemTipo"><option value="servico">Serviço</option><option value="peca">Peça</option></select></label>
    <label>Código<input name="itemCodigo" maxlength="40"></label>
    <label class="descricao">Descrição<input name="itemDescricao" maxlength="300" placeholder="Ex.: troca de pastilhas de freio"></label>
    <label>Qtd / horas<input name="itemQuantidade" inputmode="decimal" value="1"></label>
    <label>Valor unitário (R$)<input name="itemValor" inputmode="decimal" placeholder="0,00"></label>
    <button type="button" data-adicionar>Adicionar</button>
  </div>`;
}

/** Liga o mini-formulário de item: valida e entrega o item pronto para a API. */
function ligarFormItem(raiz, aoAdicionar) {
  const bloco = $("[data-form-item]", raiz);
  const el = (n) => $(`[name=${n}]`, bloco);
  const adicionar = async (botao) =>
    acao(botao, async () => {
      const descricao = el("itemDescricao").value.trim();
      if (!descricao) { el("itemDescricao").focus(); throw new Error("Descreva o serviço ou a peça."); }
      const quantidade = paraNumero(el("itemQuantidade").value || "1");
      if (!(quantidade > 0)) throw new Error("Quantidade deve ser maior que zero.");
      const item = {
        tipo: el("itemTipo").value,
        codigo: el("itemCodigo").value.trim() || null,
        descricao,
        quantidade,
        valorUnitarioCentavos: paraCentavos(el("itemValor").value),
      };
      await aoAdicionar(item);
      el("itemCodigo").value = "";
      el("itemDescricao").value = "";
      el("itemQuantidade").value = "1";
      el("itemValor").value = "";
      el("itemDescricao").focus();
    });
  $("[data-adicionar]", bloco).addEventListener("click", (e) => adicionar(e.target));
  bloco.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); adicionar($("[data-adicionar]", bloco)); }
  });
}

// ---------- detalhe da OS ----------
const ROTULO_EVENTO = {
  aberta: () => "OS aberta",
  status: (e) => `${STATUS[e.de] ?? e.de} → ${STATUS[e.para] ?? e.para}`,
  item_adicionado: () => "Item adicionado",
  item_removido: () => "Item removido",
  desconto: () => "Desconto alterado",
};

async function telaOs(id) {
  const os = await api("GET", `/api/ordens/${id}`);
  renderOs(os);
}

function renderOs(os) {
  const c = os.cliente;
  const v = os.veiculo;
  const linhasItens = os.itens
    .map((i) => `<tr>
      <td><span class="tipo-item ${i.tipo}">${i.tipo === "servico" ? "Serviço" : "Peça"}</span></td>
      <td>${esc(i.descricao)}${i.codigo ? `<div class="secundario">Cód. ${esc(i.codigo)}</div>` : ""}</td>
      <td class="n">${qtd(i.quantidade)}</td>
      <td class="n">${reais(i.valorUnitarioCentavos)}</td>
      <td class="n">${reais(i.totalCentavos)}</td>
      <td class="n">${os.editavel ? `<button type="button" class="discreto" data-remover-item="${i.id}" aria-label="Remover ${esc(i.descricao)}">✕</button>` : ""}</td>
    </tr>`)
    .join("");

  const botoesStatus = os.proximosStatus
    .map((p) => `<button type="button" data-status="${p.status}" class="${p.status === "cancelada" ? "perigo" : "primario"}">${
      { aprovada: "Aprovar orçamento", em_andamento: os.status === "concluida" ? "Reabrir (retrabalho)" : "Iniciar serviço",
        aguardando_peca: "Aguardando peça", concluida: "Concluir serviço", entregue: "Entregar ao cliente", cancelada: "Cancelar OS" }[p.status] ?? p.rotulo
    }</button>`)
    .join("");

  const travada = os.status === "entregue" || os.status === "cancelada";

  conteudo.innerHTML = `
    <div class="cabecalho">
      <div>
        <h1>OS nº ${os.numero} ${statusHtml(os.status)}</h1>
        <p class="subtitulo">Aberta em ${dataHora(os.abertaEm)}${os.previsaoEntrega ? ` · previsão ${dataIso(os.previsaoEntrega)}` : ""}${os.motivoCancelamento ? ` · cancelada: ${esc(os.motivoCancelamento)}` : ""}</p>
      </div>
      <div class="acoes">
        <a class="botao" href="/ordens/${os.id}/imprimir" target="_blank" rel="noopener">Imprimir</a>
        ${botoesStatus}
      </div>
    </div>
    <div class="duas-colunas">
      <div class="pilha">
        <section class="grade c2">
          <div class="cartao dados">
            <h3>Veículo</h3>
            <p>${placaHtml(v.placa, true)}</p>
            <p><b>${esc(v.marca)} ${esc(v.modelo)}</b>${v.ano ? ` · ${v.ano}` : ""}</p>
            <p class="secundario">${[v.cor, v.combustivel].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</p>
            <p class="secundario">KM entrada: ${os.kmEntrada != null ? os.kmEntrada.toLocaleString("pt-BR") : "—"}${v.chassi ? ` · Chassi ${esc(v.chassi)}` : ""}</p>
          </div>
          <div class="cartao dados">
            <h3>Cliente</h3>
            <p><b><a href="#/clientes/${os.clienteId}">${esc(c.nome)}</a></b></p>
            <p class="secundario">CPF/CNPJ: ${formatarDocumento(c.documento)}</p>
            <p>${esc(c.telefone ?? "—")}</p>
            <p class="secundario">${esc(c.email ?? "")}</p>
            <p class="secundario">${esc(c.endereco ?? "")}</p>
          </div>
        </section>
        <section class="cartao">
          <h3>Problema relatado</h3>
          <p class="texto-livre">${esc(os.defeitoRelatado)}</p>
        </section>
        <section class="cartao">
          <h3>Diagnóstico e observações</h3>
          <form id="form-diag" class="grade">
            <label>Diagnóstico técnico<textarea name="diagnostico" ${travada ? "disabled" : ""}>${esc(os.diagnostico ?? "")}</textarea></label>
            <label>Observações<textarea name="observacoes" ${travada ? "disabled" : ""}>${esc(os.observacoes ?? "")}</textarea></label>
            <div class="grade c2">
              <label>Previsão de entrega<input type="date" name="previsaoEntrega" value="${esc(os.previsaoEntrega ?? "")}" ${travada ? "disabled" : ""}></label>
              <label>KM de entrada<input name="kmEntrada" inputmode="numeric" value="${os.kmEntrada ?? ""}" ${travada ? "disabled" : ""}></label>
            </div>
            ${travada ? "" : `<div><button type="submit">Salvar anotações</button></div>`}
          </form>
        </section>
        <section class="cartao">
          <h3>Serviços e peças</h3>
          <div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Tipo</th><th>Descrição</th><th class="n">Qtd</th><th class="n">Unitário</th><th class="n">Total</th><th></th></tr></thead>
            <tbody id="itens-os">${linhasItens || `<tr><td colspan="6" class="vazio">Nenhum item lançado ainda.</td></tr>`}</tbody>
          </table></div>
          ${os.editavel ? formItemHtml() : `<p class="secundario">Itens bloqueados: a OS está ${esc(os.statusRotulo.toLowerCase())}.</p>`}
        </section>
      </div>
      <aside class="pilha">
        <section class="cartao totais">
          <h3>Valores</h3>
          <p><span>Serviços</span><span>${reais(os.totais.servicosCentavos)}</span></p>
          <p><span>Peças</span><span>${reais(os.totais.pecasCentavos)}</span></p>
          <p><span>Desconto</span><span>${os.totais.descontoCentavos ? "− " + reais(os.totais.descontoCentavos) : reais(0)}</span></p>
          <p class="total"><span>Total</span><span>${reais(os.totais.totalCentavos)}</span></p>
          <form id="form-valores" class="grade">
            <label>Desconto (R$)<input name="desconto" inputmode="decimal" value="${os.totais.descontoCentavos ? (os.totais.descontoCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""}" ${os.editavel ? "" : "disabled"}></label>
            <label>Forma de pagamento<select name="formaPagamento" ${travada ? "disabled" : ""}>
              ${["", "Dinheiro", "PIX", "Cartão de débito", "Cartão de crédito", "Boleto", "Faturado"].map((f) => `<option ${f === (os.formaPagamento ?? "") ? "selected" : ""}>${f}</option>`).join("")}
            </select></label>
            ${travada ? "" : `<button type="submit">Salvar valores</button>`}
          </form>
        </section>
        <section class="cartao">
          <h3>Histórico</h3>
          <ol class="linha-tempo">
            ${os.eventos.slice().reverse().map((e) => `<li>${esc((ROTULO_EVENTO[e.tipo] ?? (() => e.tipo))(e))}${e.detalhe && e.tipo !== "aberta" ? `<div class="secundario">${esc(e.detalhe)}</div>` : ""}<time>${dataHora(e.criadoEm)}</time></li>`).join("")}
          </ol>
        </section>
      </aside>
    </div>`;

  const atualizar = (nova) => renderOs(nova);

  $$("[data-status]").forEach((b) =>
    b.addEventListener("click", () =>
      acao(b, async () => {
        const status = b.dataset.status;
        let motivo;
        if (status === "cancelada") {
          motivo = await perguntar("Cancelar OS", "Motivo do cancelamento");
          if (!motivo) return;
        } else if (status === "entregue" && !confirm(`Confirmar entrega do veículo ${formatarPlaca(v.placa)} e encerrar a OS?`)) {
          return;
        }
        const nova = await api("POST", `/api/ordens/${os.id}/status`, { status, motivo });
        avisar(`OS marcada como ${STATUS[status].toLowerCase()}.`);
        atualizar(nova);
      }),
    ),
  );

  $$("[data-remover-item]").forEach((b) =>
    b.addEventListener("click", () =>
      acao(b, async () => atualizar(await api("DELETE", `/api/ordens/${os.id}/itens/${b.dataset.removerItem}`))),
    ),
  );

  if (os.editavel) {
    ligarFormItem(conteudo, async (item) => {
      atualizar(await api("POST", `/api/ordens/${os.id}/itens`, item));
      avisar("Item adicionado.");
      $("[name=itemDescricao]")?.focus();
    });
  }

  $("#form-diag").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target.elements;
    acao($("button", e.target), async () => {
      const km = f.kmEntrada.value.trim();
      atualizar(await api("PATCH", `/api/ordens/${os.id}`, {
        diagnostico: f.diagnostico.value,
        observacoes: f.observacoes.value,
        previsaoEntrega: f.previsaoEntrega.value || null,
        kmEntrada: km ? paraNumero(km) : null,
      }));
      avisar("Anotações salvas.");
    });
  });

  $("#form-valores").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target.elements;
    acao($("button", e.target), async () => {
      const corpo = { formaPagamento: f.formaPagamento.value || null };
      if (os.editavel) corpo.descontoCentavos = paraCentavos(f.desconto.value);
      atualizar(await api("PATCH", `/api/ordens/${os.id}`, corpo));
      avisar("Valores salvos.");
    });
  });
}

// ---------- clientes ----------
async function telaClientes() {
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Clientes</h1><p class="subtitulo">Busque por nome, CPF/CNPJ ou telefone.</p></div></div>
    <div class="filtros"><input type="search" id="busca-cliente" placeholder="Buscar cliente" aria-label="Buscar cliente"></div>
    <div class="cartao tabela-rolagem" id="lista-clientes"></div>`;
  const carregar = async (busca = "") => {
    const lista = await api("GET", `/api/clientes?busca=${encodeURIComponent(busca)}`);
    if (!$("#lista-clientes")) return;
    $("#lista-clientes").innerHTML = `<table class="tabela">
      <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th class="esconder-celular">E-mail</th></tr></thead>
      <tbody>${lista.map((c) => `<tr class="clicavel" data-id="${c.id}" tabindex="0">
        <td><b>${esc(c.nome)}</b></td><td>${formatarDocumento(c.documento)}</td><td>${esc(c.telefone ?? "—")}</td>
        <td class="esconder-celular">${esc(c.email ?? "")}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Nenhum cliente encontrado.</td></tr>`}
      </tbody></table>`;
    $("#lista-clientes tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) location.hash = `#/clientes/${tr.dataset.id}`;
    });
  };
  $("#busca-cliente").addEventListener("input", debounce((e) => carregar(e.target.value.trim()).catch((er) => avisar(er.message, true))));
  await carregar();
}

async function telaCliente(id) {
  const c = await api("GET", `/api/clientes/${id}`);
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>${esc(c.nome)}</h1><p class="subtitulo">Cliente desde ${dataCurta(c.criadoEm)}</p></div>
      <div class="acoes"><a class="botao" href="#/clientes">Voltar</a></div></div>
    <div class="duas-colunas">
      <div class="pilha">
        <form class="cartao" id="form-cliente">
          <h3>Dados do cliente</h3>
          <div class="grade c2">
            <label class="obrigatorio">Nome<input name="nome" required value="${esc(c.nome)}"></label>
            <label>CPF ou CNPJ<input name="documento" value="${esc(c.documento ? formatarDocumento(c.documento) : "")}"></label>
            <label>Telefone<input name="telefone" value="${esc(c.telefone ?? "")}"></label>
            <label>E-mail<input name="email" type="email" value="${esc(c.email ?? "")}"></label>
            <label class="ocupa-tudo">Endereço<input name="endereco" value="${esc(c.endereco ?? "")}"></label>
            <label class="ocupa-tudo">Observações<textarea name="observacoes">${esc(c.observacoes ?? "")}</textarea></label>
          </div>
          <div class="rodape-form"><button class="primario" type="submit">Salvar cliente</button></div>
        </form>
        <section class="cartao tabela-rolagem">
          <h3>Ordens de serviço</h3>
          <table class="tabela"><thead><tr><th>Nº</th><th>Placa</th><th>Status</th><th>Abertura</th></tr></thead>
          <tbody>${c.ordens.map((o) => `<tr class="clicavel" data-id="${o.id}"><td class="numero-os">${o.numero}</td><td>${placaHtml(o.placa)}</td><td>${statusHtml(o.status)}</td><td>${dataCurta(o.abertaEm)}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Nenhuma OS ainda.</td></tr>`}</tbody></table>
        </section>
      </div>
      <aside class="cartao">
        <h3>Veículos</h3>
        ${c.veiculos.map((v) => `<p>${placaHtml(v.placa)} ${esc(v.marca)} ${esc(v.modelo)}${v.ano ? ` (${v.ano})` : ""}<br><span class="secundario">${v.kmAtual != null ? `${v.kmAtual.toLocaleString("pt-BR")} km` : ""}</span></p>`).join("") || `<p class="secundario">Nenhum veículo.</p>`}
      </aside>
    </div>`;
  $("tbody", conteudo).addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = `#/os/${tr.dataset.id}`;
  });
  $("#form-cliente").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target.elements;
    acao($("button[type=submit]", e.target), async () => {
      await api("PUT", `/api/clientes/${c.id}`, {
        nome: f.nome.value, documento: f.documento.value, telefone: f.telefone.value,
        email: f.email.value, endereco: f.endereco.value, observacoes: f.observacoes.value,
      });
      avisar("Cliente atualizado. As OS já abertas mantêm os dados da época.");
    });
  });
}

// ---------- início ----------
api("GET", "/api/config")
  .then((cfg) => {
    $("#nome-oficina").textContent = cfg.nomeOficina;
    document.title = `${cfg.nomeOficina} · Gestão de OS`;
  })
  .catch(() => {});
navegar();
