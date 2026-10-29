-- Mecânicos responsáveis pelas OS e anotações feitas pelo celular.

CREATE TABLE mecanicos (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome       text NOT NULL CHECK (length(btrim(nome)) > 0),
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mecanicos_nome_idx ON mecanicos (lower(btrim(nome)));

ALTER TABLE ordens_servico ADD COLUMN mecanico_id integer REFERENCES mecanicos (id);
CREATE INDEX os_mecanico_idx ON ordens_servico (mecanico_id, status);

CREATE TABLE os_notas (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  os_id        integer NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
  mecanico_id  integer REFERENCES mecanicos (id),
  autor        text NOT NULL,
  texto        text NOT NULL CHECK (length(btrim(texto)) > 0),
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX os_notas_os_idx ON os_notas (os_id, id);
