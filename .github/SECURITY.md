# Segurança

Não abra uma issue pública para relatar uma vulnerabilidade ou possível
exposição de dados. Use **Security advisories** no GitHub para enviar o relato
privadamente ao mantenedor.

Nunca inclua tokens, chaves privadas, APKs configurados, logs reais ou
endereços internos no relato. Revogue imediatamente qualquer credencial
publicada por engano, mesmo que o arquivo ou commit seja removido depois.

## Configuração local

- mantenha credenciais somente em `.env`, arquivos com permissão `0600` ou no
  gerenciador de segredos do ambiente;
- use `.env.example` apenas como modelo e somente com valores fictícios;
- não versione APKs, bancos, certificados, keystores ou configurações reais de
  proxy e SSH;
- execute testes e um scanner de segredos antes de publicar alterações.

O workflow `Secret scan` executa o Gitleaks em pushes e pull requests. Uma falha
deve ser investigada antes da integração.
