# Estudo de caso: Notserver Monitor

## Contexto

Administrar um servidor pequeno costuma exigir alternar entre SSH, `systemctl`,
Docker e `journalctl`. O Notserver Monitor concentra esses sinais em uma visão
responsiva, mantendo a coleta somente leitura e sem instalar um agente no host
monitorado.

## Objetivos

- mostrar rapidamente se o servidor está acessível;
- separar infraestrutura, serviços `systemd` e projetos Docker Compose;
- funcionar no navegador e em um aplicativo Android compacto;
- manter a API vinculada ao loopback e protegida por autenticação;
- evitar que instabilidades curtas da rede gerem alarmes falsos;
- não persistir métricas, logs ou credenciais no projeto.

## Arquitetura

O backend usa os módulos nativos do Node.js e inicia uma coleta local ou uma
sessão SSH não interativa. Um script fixo consulta `/proc`, `df`, `systemctl`,
Docker e `journalctl`. A saída textual é dividida em seções e normalizada antes
de chegar à API.

```text
Browser / Android
       │ HTTPS + token
       ▼
API Node.js em 127.0.0.1
       │
       ├── comandos locais somente leitura
       └── SSH BatchMode ──> servidor Linux
```

A interface web é servida pelo mesmo processo. O aplicativo Android usa uma
`WebView` para o painel e componentes nativos para health checks, notificações e
atualizações privadas.

## Decisões técnicas

### Backend sem dependências

O servidor usa `node:http`, streams, processos filhos e testes nativos. Isso
reduz o tamanho da instalação e a superfície de atualização de dependências em
um serviço operacional pequeno.

### Coleta com comandos fechados

A API não recebe comandos do cliente. O script remoto é definido no código e os
dois valores variáveis — destino SSH e unidade `systemd` — passam por validação
estrita. O painel não oferece ações de reinício, exclusão ou alteração.

### Descoberta por labels oficiais

Projetos e serviços Docker Compose são derivados das labels oficiais do
Compose. Assim, novos projetos aparecem automaticamente sem uma lista mantida à
mão no frontend.

### Alertas resistentes a oscilações

Uma única falha transitória pode ser causada por troca de rede, suspensão do
Android ou reconexão do túnel. O app preserva o painel e só confirma
indisponibilidade após duas falhas consecutivas. Respostas `401` e `403` são
tratadas imediatamente como erro de autenticação, pois repetir a chamada não
resolveria o problema.

### Atualização autenticada

Metadados e APK usam a mesma API privada. Antes de abrir o instalador, o Android
confere tamanho e SHA-256. Como o endpoint e o token são incorporados durante o
build, esses APKs nunca devem ser anexados a releases públicas.

## Segurança e privacidade

- bind local por padrão;
- HTTPS obrigatório quando uma origem pública é configurada;
- token aleatório em arquivo externo ao repositório;
- comparação em tempo constante;
- cookie seguro para o painel e bearer token para chamadas nativas;
- limites de saída e tempo para processos e respostas HTTP;
- cabeçalhos de segurança e bloqueio de conteúdo misto no Android;
- exemplos públicos usam domínios, usuários e endereços reservados.

## Testes e automação

Os testes cobrem autenticação, validação de alvos e unidades, parsing da coleta,
limiares de alerta e catálogo de atualização. O CI também compila o aplicativo
Android sem credenciais e executa o Gitleaks sobre todo o histórico público.

## Resultado

O projeto oferece uma superfície operacional pequena e direta, acessível no
celular, sem transformar o dashboard em uma central de comandos privilegiada.
O modo demonstração permite avaliar a organização e os estados da interface sem
acessar uma máquina real.
