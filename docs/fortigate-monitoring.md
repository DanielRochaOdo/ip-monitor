# Monitoramento FortiGate (FortiGate 40F) - Cloud + LAN Agent

Este projeto separa o monitoramento em dois planos:

1) Cloud (fora da rede): valida alcance externo da WAN publica
2) LAN Agent (dentro da rede): valida a saude real do FortiGate e da LAN (ICMP real + API/SNMP)

## Por que "ping no CMD" != "ping na nuvem"?

- Vercel/Cloudflare nao executam ICMP ping de forma confiavel.
- IPs privados (10.x/172.16-31.x/192.168.x) nao sao roteaveis a partir da internet.
- Muitos firewalls bloqueiam conexoes TCP externas (o cloud nao consegue provar reachability sem uma porta/endpoint exposto).

## Recomendacao de arquitetura por site

Para cada site (Parangaba/Bezerra/Aguanambi/Matriz):

- Cloud: 1 monitor para cada WAN publica (TCP/HTTP)
- LAN Agent: 1 device (FortiGate) + 1 monitor ICMP/TCP/HTTP na LAN (10.85.x.254)

### WAN Cloud (fora)

Para um monitor cloud ser confiavel, e necessario existir algo que responda na WAN:

- TCP: porta 443/80 (idealmente um endpoint/servico exposto)
- HTTP: endpoint com status esperado (ex.: 200)

Obs.: Se o FortiGate bloquear 100% do inbound, o cloud nao consegue diferenciar "link up" de "bloqueio".

## FortiGate API (preferido)

### Criar API token no FortiGate (alto nivel)

1) No FortiGate, crie um usuario/administrador dedicado para monitoramento (sem privilegios alem do necessario)
2) Gere um API token para este usuario
3) Restrinja o acesso do token por IP (Trusted Hosts / Address) para permitir somente o IP do LAN Agent

### Portas / Acesso

- HTTPS (recomendado): 443 (ou 8443 se voce usa porta custom)
- SSH (opcional): 22
- SNMP (fallback): 161/udp

Boas praticas:

- Permitir acesso somente a partir do IP da maquina do agente
- Nao expor o management na WAN se nao for necessario
- Use certificado confiavel no HTTPS do FortiGate para evitar desativar validacao TLS no agente

### Como o agente usa o token (sem gravar no Supabase)

- No Supabase: `network_devices.api_token_secret_ref` guarda apenas o nome da variavel (ex.: `FGT_PARANGABA_TOKEN`)
- No agente: voce define `FGT_PARANGABA_TOKEN=...` no `.env` do agente

Assim o token nunca fica em texto no banco.

## SNMP (fallback)

Se a API nao estiver disponivel, o agente pode usar SNMP v2c (implementado) para:

- sysUpTime
- CPU e memoria via OIDs Fortinet

Recomendacao: prefira API; SNMP v3 pode ser adotado depois (requer mais configuracao).

## Sites (referencia)

- FW-ODONTOART-PARANGABA: WAN 177.200.87.218, LAN 10.85.2.254
- FW-ODONTOART-BEZERRA: WAN 187.110.232.241 (PPPoE), LAN 10.85.4.254
- FW-ODONTOART-AGUANAMBI: WAN 187.110.232.222 (PPPoE), LAN 10.85.3.254
- FW-ODONTOART-MATRIZ: WAN 189.84.127.130 e 100.90.122.213 (PPPoE), LAN 10.85.1.254

## Como cadastrar os 4 FortiGates no Supabase

1) Crie um Agente LAN no app (`/settings`) e anote o `agent_id` (tabela `agents`).
2) No Supabase SQL Editor, insira os devices (ajuste `agent_id` e os nomes das env vars dos tokens):

```sql
-- Substitua pelo id do agente LAN do site
-- e pelos nomes das env vars no lan-agent/.env (api_token_secret_ref).

insert into network_devices (user_id, site, vendor, model, wan_public_ips, lan_ip, agent_id, mgmt_method, mgmt_port, api_base_url, api_token_secret_ref)
values
  ('<USER_ID>', 'Parangaba', 'Fortinet', 'FortiGate 40F', array['177.200.87.218'], '10.85.2.254', '<AGENT_ID_PARANGABA>', 'API', 443, 'https://10.85.2.254:443', 'FGT_PARANGABA_TOKEN'),
  ('<USER_ID>', 'Bezerra',   'Fortinet', 'FortiGate 40F', array['187.110.232.241'], '10.85.4.254', '<AGENT_ID_BEZERRA>',   'API', 443, 'https://10.85.4.254:443', 'FGT_BEZERRA_TOKEN'),
  ('<USER_ID>', 'Aguanambi', 'Fortinet', 'FortiGate 40F', array['187.110.232.222'], '10.85.3.254', '<AGENT_ID_AGUANAMBI>', 'API', 443, 'https://10.85.3.254:443', 'FGT_AGUANAMBI_TOKEN'),
  ('<USER_ID>', 'Matriz',    'Fortinet', 'FortiGate 40F', array['189.84.127.130','100.90.122.213'], '10.85.1.254', '<AGENT_ID_MATRIZ>', 'API', 443, 'https://10.85.1.254:443', 'FGT_MATRIZ_TOKEN');
```

3) No `lan-agent/.env`, adicione as env vars correspondentes:

```bash
FGT_PARANGABA_TOKEN=...
FGT_BEZERRA_TOKEN=...
FGT_AGUANAMBI_TOKEN=...
FGT_MATRIZ_TOKEN=...
```
