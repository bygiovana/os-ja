# OS Já — ordens de serviço para oficina mecânica

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
- **Modo Mecânico no celular** (`/#/m`): cada mecânico vê os carros com ele e a fila, pega um carro, inicia, marca "aguardando peça", conclui, registra diagnóstico, lança serviços e peças (o valor pode ficar para o escritório) e escreve anotações. Instalável na tela inicial do celular.
- **Equipe**: cadastro dos mecânicos, responsável por OS e QR code para conectar os celulares.
- Login opcional por usuário e senha.

## Celulares dos mecânicos

1. No computador da oficina, libere o acesso pela rede: no Windows instalado pelo .msi, abra
   **OS Já — Liberar celulares** no menu Iniciar (define usuário/senha, `HOST=0.0.0.0` e libera a
   porta no firewall só para redes privadas). Sem o instalador: `HOST=0.0.0.0`, `APP_USUARIO` e `APP_SENHA`.
2. Abra **Equipe** no sistema, cadastre os mecânicos e escaneie o QR code com o celular (mesmo Wi-Fi).
3. No celular: Chrome → ⋮ → **Adicionar à tela inicial** (iPhone: Compartilhar → Adicionar à Tela de Início).

> Como o acesso na rede local é por `http://`, o celular cria um atalho para o app (o modo offline
> completo de PWA exige HTTPS). Os dados nunca ficam guardados no celular.

## Instalador para Windows (.msi)

Para usar na oficina sem instalar nada antes: rode `GestaoOS-<versão>.msi` como administrador.
Ele instala o sistema com Node.js e PostgreSQL embutidos, cria os serviços **OS Já** e
**GestaoOS-Banco** (iniciam com o Windows) e o atalho que abre http://localhost:7300.
Os dados ficam em `C:\ProgramData\GestaoOS` e são mantidos ao atualizar ou desinstalar.
Detalhes de configuração, rede e backup em [`instalador/LEIA-ME.txt`](instalador/LEIA-ME.txt).

Para gerar o .msi (Windows com Node.js 20+ e .NET SDK 8+):

```powershell
powershell -ExecutionPolicy Bypass -File instalador\build.ps1
```

O GitHub Actions também gera o .msi ao publicar uma tag (`git tag v0.2.0 && git push --tags`).

## Rodando com Docker

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
| `GET` | `/api/ordens?status=&busca=&mecanico=&limite=&antesDe=` | lista (busca por nº, placa ou cliente; `mecanico=nenhum` = fila) |
| `GET` / `PATCH` | `/api/ordens/:id` | detalhe / diagnóstico, observações, desconto, pagamento |
| `POST` | `/api/ordens/:id/status` | `{ "status": "aprovada" }` (cancelar exige `motivo`) |
| `POST` / `DELETE` | `/api/ordens/:id/itens[/:itemId]` | lança ou remove serviço/peça |
| `PATCH` | `/api/ordens/:id/itens/:itemId` | ajusta descrição, quantidade ou valor (permitido até a OS ser entregue) |
| `PUT` | `/api/ordens/:id/mecanico` | `{ "mecanicoId": 3 }` ou `null` |
| `POST` | `/api/ordens/:id/notas` | anotação `{ "texto": "...", "mecanicoId": 3 }` |
| `GET` / `POST` / `PATCH` | `/api/mecanicos[/:id]` | mecânicos (`?todos=1` inclui desativados) |
| `GET` | `/api/conexao` | se os celulares conseguem acessar e os endereços na rede |
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

- Usuários individuais com perfis (mecânico, atendente, gerente) — hoje o login é único e o mecânico escolhe o nome
- Fotos do veículo pelo celular
- HTTPS na rede local para o app funcionar offline
- Cadastro de peças com estoque e tabela de preços de serviços
- Envio do orçamento por WhatsApp para aprovação do cliente
- Emissão de NFS-e / NF-e via integração
