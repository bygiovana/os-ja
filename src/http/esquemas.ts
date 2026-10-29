import { z } from "zod";
import {
  STATUS_OS,
  documentoValido,
  normalizarPlaca,
  placaValida,
  somenteDigitos,
} from "../domain/ordem-servico.js";

const textoOpcional = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const idParam = z.coerce.number().int().positive();

export const documento = z
  .string()
  .trim()
  .transform(somenteDigitos)
  .refine((d) => d === "" || documentoValido(d), "CPF ou CNPJ inválido")
  .transform((d) => (d === "" ? null : d));

export const placa = z
  .string()
  .trim()
  .transform(normalizarPlaca)
  .refine(placaValida, "placa inválida (use ABC1234 ou ABC1D23)");

export const clienteEntrada = z.object({
  nome: z.string().trim().min(2, "informe o nome do cliente").max(200),
  documento: documento.optional().nullable().transform((v) => v ?? null),
  telefone: textoOpcional,
  email: z
    .string()
    .trim()
    .email("e-mail inválido")
    .max(200)
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v ? v.toLowerCase() : null)),
  endereco: textoOpcional,
  observacoes: textoOpcional,
});
export type ClienteEntrada = z.infer<typeof clienteEntrada>;

const anoAtual = new Date().getFullYear();

export const veiculoEntrada = z.object({
  placa,
  marca: z.string().trim().min(1, "informe a marca").max(80),
  modelo: z.string().trim().min(1, "informe o modelo").max(120),
  ano: z.coerce.number().int().min(1900).max(anoAtual + 1).optional().nullable(),
  cor: textoOpcional,
  chassi: textoOpcional,
  combustivel: textoOpcional,
  kmAtual: z.coerce.number().int().min(0).optional().nullable(),
});
export type VeiculoEntrada = z.infer<typeof veiculoEntrada>;

export const itemEntrada = z.object({
  tipo: z.enum(["servico", "peca"]),
  codigo: textoOpcional,
  descricao: z.string().trim().min(1, "descreva o item").max(300),
  quantidade: z.coerce.number().positive("quantidade deve ser maior que zero").max(100000),
  valorUnitarioCentavos: z.coerce.number().int().min(0).max(100_000_000),
});
export type ItemEntrada = z.infer<typeof itemEntrada>;

const dataOpcional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD")
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const referencia = z.object({ id: idParam }).strict();

/** Aceita `{ id }` de um cadastro existente ou os dados completos para cadastrar/atualizar. */
function referenciaOuDados<T extends z.ZodTypeAny>(dados: T) {
  return z.unknown().transform((valor, ctx): { id: number } | z.infer<T> => {
    const usaId = typeof valor === "object" && valor !== null && "id" in valor && (valor as { id?: unknown }).id != null;
    const r = (usaId ? referencia : dados).safeParse(valor);
    if (!r.success) {
      for (const issue of r.error.issues) ctx.addIssue(issue as z.IssueData);
      return z.NEVER;
    }
    return r.data;
  });
}

/**
 * Abertura da OS: cliente e veículo podem vir por id (já cadastrados)
 * ou com os dados completos — nesse caso são cadastrados/atualizados na mesma operação.
 */
export const novaOrdemEntrada = z.object({
  cliente: referenciaOuDados(clienteEntrada),
  veiculo: referenciaOuDados(veiculoEntrada),
  kmEntrada: z.coerce.number().int().min(0).optional().nullable(),
  defeitoRelatado: z.string().trim().min(3, "descreva o problema relatado pelo cliente").max(2000),
  observacoes: textoOpcional,
  previsaoEntrega: dataOpcional,
  itens: z.array(itemEntrada).max(200).optional().default([]),
});
export type NovaOrdemEntrada = z.infer<typeof novaOrdemEntrada>;

export const atualizarOrdemEntrada = z
  .object({
    diagnostico: textoOpcional,
    observacoes: textoOpcional,
    previsaoEntrega: dataOpcional,
    kmEntrada: z.coerce.number().int().min(0).nullable(),
    descontoCentavos: z.coerce.number().int().min(0),
    formaPagamento: textoOpcional,
  })
  .partial();

export const mudarStatusEntrada = z.object({
  status: z.enum(STATUS_OS),
  motivo: z.string().trim().max(500).optional(),
});
