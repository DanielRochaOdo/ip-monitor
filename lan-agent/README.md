# LAN Agent (ip-monitor)

Este agente roda dentro da sua rede (LAN) e executa checks que nao funcionam na nuvem (ICMP real e acesso aos IPs 10.85.x.254).

## Requisitos

- Node.js 18+ (recomendado 20+)
- Acesso de rede do agente para os IPs LAN (ex.: 10.85.x.254)
- Para ICMP em Linux/Docker: permissao `CAP_NET_RAW`

## Configuracao

1) Copie `lan-agent/.env.example` para `lan-agent/.env`

2) Preencha:

- `APP_URL` = URL do seu app (Vercel)
- `AGENT_TOKEN` = token gerado em `Settings > Agentes LAN` (o token aparece uma unica vez)

3) (Opcional) FortiGate API tokens:

- Crie variaveis no `.env` do agente (ex.: `FGT_PARANGABA_TOKEN=...`)
- No Supabase, em `network_devices.api_token_secret_ref`, coloque o nome da env var (ex.: `FGT_PARANGABA_TOKEN`)

## Intervalos (monitores x devices)

- **Monitores (UP/DOWN)**: o agente faz pull a cada `AGENT_MONITOR_POLL_SECONDS` (padrao 60s) para respeitar os intervalos definidos em cada monitor.
- **FortiGate (metricas)**: para evitar rajadas e 429, o agente roda **round-robin** (um device por vez) a cada `AGENT_DEVICE_STEP_SECONDS` (padrao 60s). Com 4 devices, cada device e checado em ~4 minutos.
  - O endpoint de **interfaces** (WAN/LAN up/down) roda com cache por device a cada `AGENT_DEVICE_INTERFACE_INTERVAL_SECONDS` (padrao 600s / 10 min).
  - O endpoint de **status** (hostname/firmware/uptime) roda com cache por device a cada `AGENT_DEVICE_STATUS_INTERVAL_SECONDS` (padrao 86400s / 24h).

Defaults recomendados (estaveis para poucos devices):

- `AGENT_CONCURRENCY=2` (monitores)
- `AGENT_DEVICE_CONCURRENCY=1` (compat; o scheduler roda 1 por step)
- `AGENT_DEVICE_STEP_SECONDS=60` (1 device/min)
- `AGENT_DEVICE_INTERFACE_INTERVAL_SECONDS=600` (10 min)

Se voce ver `DEGRADED` com erro 429, aumente `AGENT_DEVICE_STEP_SECONDS` (ex.: 60 -> 120) e/ou `AGENT_DEVICE_INTERFACE_INTERVAL_SECONDS` (ex.: 600 -> 1200).

## Verificacao manual ("Monitorar agora")

No dashboard, cada FortiGate tem um botao **Monitorar agora**. Isso cria uma solicitacao no banco e o LAN Agent prioriza esse device na proxima rodada.

Requisito: aplicar a migration `supabase/migrations/005_device_run_requests.sql` no Supabase.

## Rodar local

```bash
cd lan-agent
npm install
npm run dev
```

## Rodar via Docker

```bash
cd lan-agent
cp .env.example .env
docker compose up -d --build
```

## Observacoes importantes

- FortiGate com HTTPS self-signed: o Node pode bloquear o TLS. A forma rapida (menos segura) e definir `NODE_TLS_REJECT_UNAUTHORIZED=0` no container/host do agente. Melhor: instalar um certificado confiavel no FortiGate e no host.
- WAN cloud: so funciona se existir algum servico exposto para o mundo (TCP/HTTP). Se o FortiGate bloquear tudo, a nuvem nao consegue provar que a WAN esta UP.
