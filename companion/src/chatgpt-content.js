/* StudyNoMentor Companion — executor no ChatGPT web.
 * Usa exclusivamente a sessão do usuário em chatgpt.com. Não usa API, chave
 * secreta, cookie externo ou token exportado. Se o usuário não estiver logado,
 * a execução falha de forma explícita e retorna ao StudyNoMentor.
 */
'use strict';

(() => {
  if (window.top !== window.self) return;

  const CLAIM_RETRIES = 30;
  const CLAIM_DELAY_MS = 1000;
  const COMPOSER_TIMEOUT_MS = 30000;
  const RESPONSE_TIMEOUT_MS = 150000;
  const STABLE_TICKS = 4;
  const MAX_PROMPT_CHARS = 60000;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = v => String(v == null ? '' : v).trim();

  function sendMessage(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          const ignored = chrome.runtime.lastError; void ignored;
          resolve(response || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  async function claimJob() {
    for (let i=0;i<CLAIM_RETRIES;i++) {
      const response=await sendMessage({ kind:'plus-ai-claim' });
      if (response && response.ok && response.job) return response.job;
      await sleep(CLAIM_DELAY_MS);
    }
    return null;
  }

  function questionAsText(q={}) {
    const alternatives=Array.isArray(q.alternativas)
      ? q.alternativas.map(a=>`${text(a.letra)||'—'}) ${text(a.texto)}`).join('\n') : '';
    return [
      q.id ? `ID: ${q.id}` : '',
      q.banca ? `Banca: ${q.banca}` : '',
      q.concurso ? `Concurso: ${q.concurso}` : '',
      q.materia ? `Matéria: ${q.materia}` : '',
      q.assunto ? `Assunto: ${q.assunto}` : '',
      q.enunciado ? `Enunciado:\n${q.enunciado}` : '',
      alternatives ? `Alternativas:\n${alternatives}` : '',
      q.marcada ? `Minha resposta: ${q.marcada}` : '',
      q.correta ? `Gabarito: ${q.correta}` : '',
      typeof q.acertou==='boolean' ? `Resultado: ${q.acertou ? 'ACERTOU' : 'ERROU'}` : ''
    ].filter(Boolean).join('\n\n');
  }

  function buildPrompt(payload={}) {
    const section=text(payload.section)||'diagnostico';
    const custom=payload.customPrompts && typeof payload.customPrompts==='object'
      ? text(payload.customPrompts[section]) : '';
    if (custom) return custom.slice(0,MAX_PROMPT_CHARS);

    if (section==='professor') {
      return (`Você é um professor de alto nível especializado em concursos fiscais.\n\n`+
        `Considere a questão e, quando existirem, as análises já produzidas. Responda diretamente à pergunta do aluno, com rigor técnico e sem inventar fundamento normativo.\n\n`+
        `QUESTÃO:\n${questionAsText(payload.question||{})}\n\n`+
        `ANÁLISES EXISTENTES:\n${JSON.stringify(payload.existingAnalysis||{},null,2)}\n\n`+
        `PERGUNTA DO ALUNO:\n${text(payload.professorQuestion)||'Explique esta questão.'}`).slice(0,MAX_PROMPT_CHARS);
    }

    return (`Você é um professor de alto nível especializado em concursos fiscais.\n\n`+
      `Produza uma análise da seção "${section}" para a questão abaixo. Seja didático, preciso e não invente fundamento normativo.\n\n`+
      `${questionAsText(payload.question||{})}`).slice(0,MAX_PROMPT_CHARS);
  }

  function composerCandidates() {
    return [
      document.querySelector('#prompt-textarea'),
      document.querySelector('[contenteditable="true"]#prompt-textarea'),
      document.querySelector('textarea[data-testid="prompt-textarea"]'),
      document.querySelector('textarea[name="prompt-textarea"]'),
      document.querySelector('[data-testid="composer-text-input"][contenteditable="true"]'),
      document.querySelector('form [contenteditable="true"][data-lexical-editor="true"]'),
      document.querySelector('form .ProseMirror[contenteditable="true"]'),
      document.querySelector('main [contenteditable="true"][data-lexical-editor="true"]'),
      document.querySelector('main .ProseMirror[contenteditable="true"]')
    ].filter(Boolean);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r=el.getBoundingClientRect();
    const s=getComputedStyle(el);
    return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';
  }

  function composer() { return composerCandidates().find(visible) || null; }

  function loginRequired() {
    const body=text(document.body && document.body.innerText).toLowerCase();
    return /log in|sign up|entrar|criar conta/.test(body) && !composer();
  }

  async function waitComposer() {
    const start=Date.now();
    while (Date.now()-start<COMPOSER_TIMEOUT_MS) {
      const el=composer(); if (el) return el;
      if (loginRequired()) throw new Error('LOGIN_REQUIRED');
      await sleep(350);
    }
    throw new Error('COMPOSER_NOT_FOUND');
  }

  function setComposerValue(el,value) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if (setter) setter.call(el,value); else el.value=value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return;
    }

    try {
      const selection=window.getSelection();
      const range=document.createRange(); range.selectNodeContents(el);
      selection.removeAllRanges(); selection.addRange(range);
      document.execCommand('insertText',false,value);
    } catch (_) {
      el.textContent=value;
    }
    if (!text(el.innerText || el.textContent)) el.textContent=value;
    try { el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value})); }
    catch (_) { el.dispatchEvent(new Event('input',{bubbles:true})); }
  }

  function sendButton() {
    const selectors=[
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="enviar" i]',
      'form button[type="submit"]'
    ];
    for (const selector of selectors) {
      const candidates=[...document.querySelectorAll(selector)].filter(visible);
      const enabled=candidates.find(b=>!b.disabled && b.getAttribute('aria-disabled')!=='true');
      if (enabled) return enabled;
    }
    return null;
  }

  async function submitPrompt(el,prompt) {
    const baseline=assistantNodes().length;
    setComposerValue(el,prompt);
    for (let i=0;i<40;i++) {
      const button=sendButton();
      if (button) { button.click(); return baseline; }
      await sleep(250);
    }
    // Reserva: algumas versões do composer aceitam Enter e atrasam a criação do botão.
    try {
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      await sleep(500);
      if (assistantNodes().length>baseline || generationInProgress()) return baseline;
    } catch (_) {}
    throw new Error('SEND_BUTTON_NOT_FOUND');
  }

  function assistantNodes() {
    const selectors=[
      'main [data-message-author-role="assistant"]',
      '[data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]',
      'article [data-message-author-role="assistant"]'
    ];
    const seen=new Set(), out=[];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue; seen.add(el); out.push(el);
      }
    }
    return out;
  }

  function generationInProgress() {
    const selectors=[
      'button[data-testid="stop-button"]',
      'button[data-testid="composer-stop-button"]',
      'button[aria-label*="stop" i]',
      'button[aria-label*="parar" i]'
    ];
    return selectors.some(sel=>[...document.querySelectorAll(sel)].some(visible));
  }

  async function waitAnswer(baseline) {
    const start=Date.now();
    let previous='', stable=0;
    while (Date.now()-start<RESPONSE_TIMEOUT_MS) {
      if (loginRequired()) throw new Error('LOGIN_REQUIRED');
      const nodes=assistantNodes();
      const node=nodes.length>baseline ? nodes[nodes.length-1] : null;
      const current=text(node && (node.innerText || node.textContent));
      if (current) {
        if (current===previous) stable++; else { previous=current; stable=0; }
        if (stable>=STABLE_TICKS && !generationInProgress()) return current;
      }
      await sleep(700);
    }
    if (previous) return previous;
    throw new Error('RESPONSE_TIMEOUT');
  }

  function friendlyError(code) {
    if (code==='LOGIN_REQUIRED') return 'Entre em chatgpt.com com a mesma conta do seu ChatGPT Plus e tente novamente.';
    if (code==='COMPOSER_NOT_FOUND') return 'Não encontrei a caixa de mensagem do ChatGPT. Abra chatgpt.com, confirme que a página carregou e tente novamente.';
    if (code==='SEND_BUTTON_NOT_FOUND') return 'O ChatGPT carregou, mas o Companion não encontrou uma forma segura de enviar o prompt. A interface pode ter mudado.';
    if (code==='RESPONSE_TIMEOUT') return 'O ChatGPT não concluiu a resposta dentro do tempo esperado.';
    if (code==='EMPTY_PROMPT') return 'O StudyNoMentor não conseguiu montar o prompt desta análise.';
    return code || 'Falha ao executar o prompt no ChatGPT Plus.';
  }

  async function run(job) {
    const requestId=job && job.requestId;
    if (!requestId || !job.payload) return;
    try {
      const prompt=buildPrompt(job.payload);
      if (!prompt) throw new Error('EMPTY_PROMPT');
      const el=await waitComposer();
      const baseline=await submitPrompt(el,prompt);
      const answer=await waitAnswer(baseline);
      await sendMessage({ kind:'plus-ai-result', requestId, result:{ ok:true, text:answer, status:200 } });
    } catch (err) {
      const code=String(err && err.message || err || 'UNKNOWN');
      await sendMessage({ kind:'plus-ai-result', requestId, result:{ ok:false, text:'', error:friendlyError(code), status:code==='LOGIN_REQUIRED'?401:502 } });
    }
  }

  (async()=>{
    const job=await claimJob();
    if (job) await run(job);
  })();
})();
