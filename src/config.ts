export interface Config {
  porta: number;
  databaseUrl: string;
  nomeOficina: string;
  dadosOficina: string; // endereço, telefone, CNPJ — aparece no cabeçalho da OS impressa
  fusoHorario: string;
  usuario?: string;
  senha?: string;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Defina DATABASE_URL (veja .env.example).");
  }
  const usuario = env.APP_USUARIO?.trim() || undefined;
  const senha = env.APP_SENHA?.trim() || undefined;
  if ((usuario && !senha) || (!usuario && senha)) {
    throw new Error("Defina APP_USUARIO e APP_SENHA juntos (ou nenhum dos dois).");
  }
  return {
    porta: Number(env.PORT ?? 3000),
    databaseUrl,
    nomeOficina: env.OFICINA_NOME?.trim() || "Minha Oficina",
    dadosOficina: env.OFICINA_DADOS?.trim() || "",
    fusoHorario: env.FUSO_HORARIO?.trim() || "America/Sao_Paulo",
    usuario,
    senha,
  };
}
