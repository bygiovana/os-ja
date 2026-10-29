# Gestão de OS — oficina mecânica

Sistema web para controlar as **ordens de serviço** de uma oficina: ao abrir a OS, o sistema gera o pedido com os **dados do cliente** e do **veículo**, lança serviços e peças, calcula os valores e acompanha o carro do orçamento até a entrega.

## O que faz

- **Abertura da OS em uma tela**: digite a placa — se o carro já passou pela oficina, cliente e veículo são preenchidos automaticamente.
- **Cliente**: nome, CPF ou CNPJ (com validação), telefone, e-mail e endereço. Cadastro reaproveitado pelo CPF/CNPJ, sem duplicar.
- **Veículo**: placa (padrão antigo ou Mercosul), marca, modelo, ano, cor, combustível, chassi e quilometragem (que nunca diminui).
- **Pedido fiel ao momento da abertura**: a OS guarda uma cópia dos dados do cliente e do veículo; mudanças posteriores no cadastro não alteram OS antigas.
- **Serviços e peças** com código, quantidade (aceita fração, como 1,5 h de mão de obra), valor unitário, desconto e forma de pagamento.
- **Status com regras**: Orçamento → Aprovada → Em andamento ⇄ Aguardando peça → Concluída → Entregue. Cancelamento exige motivo; não dá para aprovar sem itens; itens ficam travados depois de concluída.
- **Histórico** de cada OS (quem mudou o quê e quando).
- **Painel** com OS em aberto, prontas para entrega, atrasadas e faturamento do mês.
- **Impressão da OS** em A4, com campos de assinatura.
- Funciona no computador e no celular; login opcional por usuário e senha.

## Rodando com Docker (recomendado)

Precisa apenas do [Docker](https://docs.docker.com/get-docker/).

```bash
cp .env.example .env      # ajuste nome da oficina, senha do banco e login
docker compose up -d --build
```

Acesse **http://localhost:3000**. Os dados ficam no volume `dados-postgres`.

## Rodando sem Docker

Precisa de Node.js 20+ e PostgreSQL 14+.

```bash
npm install
cp .env.example .env      # ajuste DATABASE_URL
node --env-file=.env --import tsx src/server.ts   # ou: npm run build && node --env-file=.env dist/server.js
```

As tabelas são criadas automaticamente na primeira execução (`src/db/migrations`).

## Configuração

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | conexão com o PostgreSQL |
| `OFICINA_NOME` / `OFICINA_DADOS` | nome, endereço, telefone e CNPJ no topo e na OS impressa |
| `APP_USUARIO` / `APP_SENHA` | ativam o login. **Use sempre que o sistema estiver acessível pela rede.** |
| `FUSO_HORARIO` | calendário usado em "faturado no mês" e "atrasadas" (padrão `America/Sao_Paulo`) |
| `PORT` | porta do servidor (padrão 3000) |

## Testes

```bash
npm test                                   # regras de negócio
DATABASE_URL_TEST=postgres://usuario:senha@localhost:5432/oficina_test npm test   # + API completa
```

> O banco indicado em `DATABASE_URL_TEST` é **apagado** a cada execução — use um banco só para testes.

O GitHub Actions (`.github/workflows/ci.yml`) roda checagem de tipos, build e todos os testes com Postgres a cada push.

## Estrutura

```
src/
  domain/ordem-servico.ts   regras puras: status, totais, CPF/CNPJ, placa
  db/migrations/            SQL versionado
  modules/                  clientes, veículos, ordens e impressão (rotas + consultas)
  http/                     roteador mínimo e validação (zod)
  app.ts, server.ts         servidor HTTP
public/                     interface web (HTML, CSS e JS puros)
test/                       testes de domínio e de integração
```

## API

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/ordens` | abre OS; `cliente` e `veiculo` aceitam `{ "id": 1 }` ou os dados completos |
| `GET` | `/api/ordens?status=&busca=&limite=&antesDe=` | lista (busca por nº, placa ou cliente) |
| `GET` / `PATCH` | `/api/ordens/:id` | detalhe / diagnóstico, observações, desconto, pagamento |
| `POST` | `/api/ordens/:id/status` | `{ "status": "aprovada" }` (cancelar exige `motivo`) |
| `POST` / `DELETE` | `/api/ordens/:id/itens[/:itemId]` | lança ou remove serviço/peça |
| `GET` | `/api/resumo` | indicadores do painel |
| `GET` | `/api/veiculos?placa=` | busca veículo e dono pela placa |
| `GET` / `POST` / `PUT` | `/api/clientes[/:id]` | clientes |
| `GET` | `/ordens/:id/imprimir` | OS pronta para imprimir |

Valores em dinheiro trafegam em **centavos** (inteiros). Exemplo de abertura:

```json
{
  "cliente": { "nome": "Maria da Silva", "documento": "529.982.247-25", "telefone": "(16) 99999-1234" },
  "veiculo": { "placa": "BRA2E19", "marca": "Volkswagen", "modelo": "Gol 1.0", "ano": 2018 },
  "kmEntrada": 85320,
  "defeitoRelatado": "Barulho na suspensão dianteira",
  "itens": [{ "tipo": "servico", "descricao": "Diagnóstico", "quantidade": 1, "valorUnitarioCentavos": 15000 }]
}
```

## Próximos passos sugeridos

- Usuários individuais com perfis (mecânico, atendente, gerente)
- Cadastro de peças com estoque e tabela de preços de serviços
- Envio do orçamento por WhatsApp para aprovação do cliente
- Emissão de NFS-e / NF-e via integração
