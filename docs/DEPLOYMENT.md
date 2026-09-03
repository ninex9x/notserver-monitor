# Implantação segura

Este documento descreve um modelo de implantação. Ajuste caminhos, domínio,
usuário e políticas de rede para o seu ambiente; não versione os valores reais.

## 1. Configure o ambiente

```bash
cp .env.example .env
chmod 600 .env
```

Para coleta por SSH, defina `MONITOR_DEMO=false`, mantenha
`MONITOR_LOCAL=false` e informe um alias ou `usuario@host` em
`NOTSERVER_SSH_TARGET`. A chave SSH deve funcionar em `BatchMode`, sem prompt.

Para coletar a própria máquina, use:

```env
MONITOR_DEMO=false
MONITOR_LOCAL=true
```

## 2. Crie a credencial

Prefira um arquivo separado e restrito:

```bash
umask 077
openssl rand -hex 32 > "$HOME/.config/notserver-monitor.token"
```

No `.env`, configure somente o caminho:

```env
MONITOR_ACCESS_TOKEN_FILE=/home/SEU_USUARIO/.config/notserver-monitor.token
```

Não use o exemplo literalmente e nunca envie o token ao Git.

## 3. Execute com systemd

Os arquivos em `deploy/` são modelos sem dados reais. Copie e revise:

```bash
mkdir -p "$HOME/.config/systemd/user"
cp deploy/notserver-monitor.service.example \
  "$HOME/.config/systemd/user/notserver-monitor.service"
systemctl --user daemon-reload
systemctl --user enable --now notserver-monitor.service
```

O modelo lê `%h/.config/notserver-monitor.env`. Crie esse arquivo a partir de
`.env.example`, use permissões `0600` e confirme o `WorkingDirectory`.

## 4. Publique atrás de HTTPS

O exemplo de Cloudflare Tunnel mantém a API em `127.0.0.1:4242`. Substitua
todos os placeholders no YAML e guarde o arquivo final fora do repositório:

```bash
cp deploy/cloudflared-notserver-monitor.yml.example \
  "$HOME/.config/cloudflared-notserver-monitor.yml"
chmod 600 "$HOME/.config/cloudflared-notserver-monitor.yml"
```

Defina `MONITOR_PUBLIC_ORIGIN=https://monitor.example.com` com o domínio real.
Restrinja o acesso no proxy e mantenha a autenticação por token no backend.

## 5. Compile o Android privadamente

```bash
cd android
MONITOR_BASE_URL=https://monitor.example.com \
MONITOR_ACCESS_TOKEN_FILE=/caminho/privado/notserver-monitor.token \
./gradlew assembleRelease
```

O APK resultante contém a URL e a credencial. Não o publique em Actions,
releases, sites ou repositórios. A chave de assinatura também deve permanecer
fora da árvore do projeto.

## Rotação

Se uma credencial ou APK configurado for exposto:

1. gere um token novo;
2. substitua o arquivo usado pelo serviço;
3. reinicie a API;
4. gere e instale um novo APK por um canal privado;
5. remova o artefato exposto, sem considerar essa remoção um substituto para a
   rotação.
