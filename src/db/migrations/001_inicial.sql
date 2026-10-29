-- Esquema inicial: clientes, veículos, ordens de serviço, itens e histórico.
-- Dinheiro sempre em centavos (bigint). Datas com fuso (timestamptz).

CREATE TABLE clientes (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome          text NOT NULL CHECK (length(btrim(nome)) > 0),
  documento     text UNIQUE CHECK (documento ~ '^([0-9]{11}|[0-9]{14})$'), -- CPF ou CNPJ, só dígitos
  telefone      text,
  email         text,
  endereco      text,
  observacoes   text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clientes_nome_idx ON clientes (lower(nome));
CREATE INDEX clientes_telefone_idx ON clientes (telefone);

CREATE TABLE veiculos (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id    integer NOT NULL REFERENCES clientes (id),
  placa         text NOT NULL UNIQUE CHECK (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  marca         text NOT NULL,
  modelo        text NOT NULL,
  ano           integer CHECK (ano BETWEEN 1900 AND 2100),
  cor           text,
  chassi        text,
  combustivel   text,
  km_atual      integer CHECK (km_atual >= 0),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX veiculos_cliente_idx ON veiculos (cliente_id);

CREATE SEQUENCE os_numero_seq START 1;

CREATE TABLE ordens_servico (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero               integer NOT NULL UNIQUE DEFAULT nextval('os_numero_seq'),
  cliente_id           integer NOT NULL REFERENCES clientes (id),
  veiculo_id           integer NOT NULL REFERENCES veiculos (id),
  -- Cópia dos dados no momento da abertura: o pedido continua fiel mesmo se o cadastro mudar.
  cliente_snapshot     jsonb NOT NULL,
  veiculo_snapshot     jsonb NOT NULL,
  status               text NOT NULL DEFAULT 'orcamento' CHECK (status IN
                         ('orcamento','aprovada','em_andamento','aguardando_peca','concluida','entregue','cancelada')),
  km_entrada           integer CHECK (km_entrada >= 0),
  defeito_relatado     text NOT NULL CHECK (length(btrim(defeito_relatado)) > 0),
  diagnostico          text,
  observacoes          text,
  previsao_entrega     date,
  desconto_centavos    bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  forma_pagamento      text,
  motivo_cancelamento  text,
  aberta_em            timestamptz NOT NULL DEFAULT now(),
  aprovada_em          timestamptz,
  concluida_em         timestamptz,
  entregue_em          timestamptz,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
ALTER SEQUENCE os_numero_seq OWNED BY ordens_servico.numero;
CREATE INDEX os_status_idx ON ordens_servico (status, numero DESC);
CREATE INDEX os_cliente_idx ON ordens_servico (cliente_id);
CREATE INDEX os_veiculo_idx ON ordens_servico (veiculo_id);
CREATE INDEX os_entregue_idx ON ordens_servico (entregue_em) WHERE status = 'entregue';

CREATE TABLE os_itens (
  id                       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  os_id                    integer NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
  tipo                     text NOT NULL CHECK (tipo IN ('servico', 'peca')),
  codigo                   text,
  descricao                text NOT NULL CHECK (length(btrim(descricao)) > 0),
  quantidade               numeric(10, 3) NOT NULL CHECK (quantidade > 0),
  valor_unitario_centavos  bigint NOT NULL CHECK (valor_unitario_centavos >= 0),
  criado_em                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX os_itens_os_idx ON os_itens (os_id);

-- Histórico append-only: abertura, mudanças de status, itens adicionados/removidos.
CREATE TABLE os_eventos (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  os_id      integer NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  de         text,
  para       text,
  detalhe    text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX os_eventos_os_idx ON os_eventos (os_id, id);
