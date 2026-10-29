// Regras puras da ordem de serviço (sem banco, sem HTTP).
// Valores monetários sempre em centavos (inteiros) para evitar erro de arredondamento.

export const STATUS_OS = [
  "orcamento",
  "aprovada",
  "em_andamento",
  "aguardando_peca",
  "concluida",
  "entregue",
  "cancelada",
] as const;

export type StatusOS = (typeof STATUS_OS)[number];

export const ROTULO_STATUS: Record<StatusOS, string> = {
  orcamento: "Orçamento",
  aprovada: "Aprovada",
  em_andamento: "Em andamento",
  aguardando_peca: "Aguardando peça",
  concluida: "Concluída",
  entregue: "Entregue",
  cancelada: "Cancelada",
};

/** Transições permitidas a partir de cada status. */
const TRANSICOES: Record<StatusOS, readonly StatusOS[]> = {
  orcamento: ["aprovada", "cancelada"],
  aprovada: ["em_andamento", "cancelada"],
  em_andamento: ["aguardando_peca", "concluida", "cancelada"],
  aguardando_peca: ["em_andamento", "cancelada"],
  concluida: ["entregue", "em_andamento"],
  entregue: [],
  cancelada: [],
};

export function proximosStatus(atual: StatusOS): readonly StatusOS[] {
  return TRANSICOES[atual];
}

export function podeTransicionar(de: StatusOS, para: StatusOS): boolean {
  return TRANSICOES[de].includes(para);
}

/** Itens só podem ser alterados enquanto a OS não foi concluída, entregue ou cancelada. */
export function permiteEditarItens(status: StatusOS): boolean {
  return ["orcamento", "aprovada", "em_andamento", "aguardando_peca"].includes(status);
}

export class TransicaoInvalidaError extends Error {
  constructor(
    public readonly de: StatusOS,
    public readonly para: StatusOS,
  ) {
    super(
      `Não é possível mudar a OS de "${ROTULO_STATUS[de]}" para "${ROTULO_STATUS[para]}".`,
    );
  }
}

export function validarTransicao(de: StatusOS, para: StatusOS, motivo?: string): void {
  if (!podeTransicionar(de, para)) throw new TransicaoInvalidaError(de, para);
  if (para === "cancelada" && !motivo?.trim()) {
    throw new Error("Informe o motivo do cancelamento.");
  }
}

export type TipoItem = "servico" | "peca";

export interface ItemCalculo {
  tipo: TipoItem;
  quantidade: number; // aceita fração (ex.: 1.5 h de mão de obra, 3.5 L de óleo)
  valorUnitarioCentavos: number;
}

export interface Totais {
  servicosCentavos: number;
  pecasCentavos: number;
  subtotalCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
}

export function totalItem(item: ItemCalculo): number {
  return Math.round(item.quantidade * item.valorUnitarioCentavos);
}

export function calcularTotais(itens: ItemCalculo[], descontoCentavos = 0): Totais {
  let servicos = 0;
  let pecas = 0;
  for (const item of itens) {
    const valor = totalItem(item);
    if (item.tipo === "servico") servicos += valor;
    else pecas += valor;
  }
  const subtotal = servicos + pecas;
  const desconto = Math.min(Math.max(0, descontoCentavos), subtotal);
  return {
    servicosCentavos: servicos,
    pecasCentavos: pecas,
    subtotalCentavos: subtotal,
    descontoCentavos: desconto,
    totalCentavos: subtotal - desconto,
  };
}

/** Placa brasileira: formato antigo (ABC1234) ou Mercosul (ABC1D23). */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function placaValida(placa: string): boolean {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizarPlaca(placa));
}

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

export function cnpjValido(cnpj: string): boolean {
  const d = somenteDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

export function documentoValido(doc: string): boolean {
  const d = somenteDigitos(doc);
  return d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false;
}
