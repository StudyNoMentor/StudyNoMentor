# StudyNoMentor Companion

Extensão Manifest V3 para Chrome/Edge que conecta o TecConcursos ao StudyNoMentor sem Tampermonkey.

## Fluxo

1. `tec-content.js` observa a resolução de uma questão no domínio do TEC.
2. A resolução é convertida em um evento imutável com `eventId`, ID da questão, horário/data local, conta TEC anonimizada, caderno, matéria, assunto, alternativa marcada, gabarito e acerto/erro.
3. `background.js` grava o evento numa fila durável em `chrome.storage.local` antes de encaminhá-lo.
4. `study-bridge.js` entrega a fila ao StudyNoMentor quando o site estiver aberto.
5. O StudyNoMentor responde com ACK; somente então o evento é retirado da fila da extensão.
6. O site mantém o histórico permanente por perfil e agrega os erros no Radar TEC.

A extensão não envia senha, cookie ou token do TEC ao StudyNoMentor. A conta TEC é representada por um fingerprint local de identificadores/labels disponíveis na própria página.

## Instalação de desenvolvimento

Chrome/Edge → Extensões → modo de desenvolvedor → **Carregar sem compactação** → selecione esta pasta `companion/`.

Depois recarregue o StudyNoMentor e o TEC. Em **Integração TEC**, o Radar deve exibir `Companion conectado`.
