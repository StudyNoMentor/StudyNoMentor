/* ============================================================
   IA TEC — compatibilidade progressiva de prompts
   ------------------------------------------------------------
   O backend novo recebe customPrompts de forma nativa. Enquanto uma instalação
   ainda estiver com a Edge Function anterior, ela já conhece professorQuestion.
   Espelhamos o prompt renderizado nesse campo para que a experiência pedagógica
   V2 funcione antes e depois do deploy do backend, sem chave no cliente.
   ============================================================ */
(() => {
  const T = window.TecIntegracaoScreen;
  if (!T || T.__promptCompatV2 || typeof T.callAI !== 'function') return;
  T.__promptCompatV2 = true;
  const original = T.callAI;
  T.callAI = function(section, professorQuestion) {
    let instruction = professorQuestion;
    try {
      if (!instruction && section !== 'professor') {
        const state = this.state(), row = state.questions && state.questions[this.selectedKey];
        const custom = row && this.customPromptsFor ? this.customPromptsFor(section, row.question || {}) : null;
        const rendered = custom && custom[section];
        if (rendered) instruction = `[PROMPT PEDAGÓGICO DO ALUNO — ${String(section || 'analise').toUpperCase()}]\n${rendered}`;
      }
    } catch (error) {
      if (typeof _quiet === 'function') _quiet(error, 'tec-ai-prompt-compat');
    }
    return original.call(this, section, instruction);
  };
})();
