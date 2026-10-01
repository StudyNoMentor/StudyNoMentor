# Ícone do Anki

O ícone exibido na navegação Anki foi obtido sem alterações do repositório oficial `ankitects/anki`:

- Arquivo: `docs-site/media/anki-logo.svg`
- Revisão: `7a4db0038e4d5570cc3a297a2b47f8fefbfc309c`
- Fonte: https://github.com/ankitects/anki/blob/7a4db0038e4d5570cc3a297a2b47f8fefbfc309c/docs-site/media/anki-logo.svg

O SVG está incorporado como data URI em `src/html/03-corpo.html`, para funcionar também no build de arquivo único e evitar dependência de carregamento externo. A marca e o ícone pertencem ao projeto Anki; a integração no Study não implica endosso do projeto oficial.

A entrada separada “Anki Oficial” e sua opção de configuração foram removidas. O módulo antes denominado Cards agora aparece como Anki, mantendo os identificadores de armazenamento, a coleção e o cliente HTTP do motor oficial. A rota antiga `anki` aponta para a tela existente `cards`.
