# Beta fechado: convidar um testador

Cada testador é um cliente: uma stack só dele em `<slug>.dougbot.app`, com o Time Doug, a IA da casa até
um teto por mês e o caminho para conectar a própria IA (docs/adr/doug-0035-beta.md).

## Uma vez por máquina

Na `/opt/doug-clientes/doug-cliente.conf` (root, 600), além do que o README pede:

```
DOUG_CHAVE_DA_CASA=sk-ant-...        # a chave Claude da Zim para o beta
DOUG_TETO_DA_CASA_USD=20             # quanto cada testador pode gastar dela por mês
```

E os pré-requisitos do README: DNS `*.dougbot.app`, proxy externo ligado, regra de sudo.

## Para cada convite

1. Escolha o próximo código livre (`doug-cliente lista`) e o slug (o primeiro nome ou a empresa).
2. `sudo doug-cliente novo 101 "Maria Souza" --slug maria`
3. Pegue o link do dono: `sudo cat /opt/doug-clientes/101-maria/link-do-dono.txt` (vale uma vez).
4. Marque o pedido em `/empresas` (se veio de lá) como `invited`, com o código.
5. Mande o e-mail abaixo, do info@, só para a pessoa.

## O e-mail

Assunto: **Seu DougBot está pronto (beta fechado)**

> Oi, {nome}!
>
> Você entrou no beta fechado do DougBot. Separamos um servidor só seu, com o Time Doug já dentro:
> o Doug, que coordena, e os agentes de design, vídeo, tráfego e social media.
>
> **1. Entre (leva 1 minuto):** {link do dono}
> Esse link é seu e vale uma vez: ele cria a sua conta de dono.
>
> **2. Siga o começo guiado.** Você diz o nome da empresa e o tom de voz, escolhe quem do time entra,
> e pronto: o time já responde, com a IA que a gente empresta no beta.
>
> **3. Conecte a sua IA quando quiser.** No passo "IA" (ou depois, em Configurações › Contas de IA)
> dá para ligar a sua conta do Claude ou do ChatGPT, ou uma chave de API. Com ela o time não tem limite
> de uso do beta.
>
> **4. No Mac e no celular:** baixe o app em https://dougbot.app/download e entre com o mesmo e-mail.
>
> Convide o seu time em Pessoas › Convidar. Qualquer dúvida, é só responder este e-mail ou chamar o Doug
> dentro do app.
>
> Equipe DougBot

## Acompanhar

- O gasto da IA da casa por testador está no feed do operador (`platform_ai.threshold` em 50% e 100%).
- Para dar mais a um testador: `PUT /api/operator/v1/orgs/{orgId}/limits` com `platformUsdPerMonth`.
