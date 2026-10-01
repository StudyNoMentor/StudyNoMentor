/* Adaptador de dados oficiais para os controles do Study. A leitura de CSV,
   os pacotes, a geração de notas e a importação pertencem ao Anki oficial. */
const AnkiImport = {
  _toNotetype(m){
    const fields=(m.flds||m.fields||[]).map((f,i)=>({name:f.name||('Field '+(i+1)),ord:i,sourceOrd:Number.isFinite(Number(f.ord))?Number(f.ord):i,id:f.id==null?null:Number(f.id),sticky:!!f.sticky,rtl:!!f.rtl,fontName:f.font||f.fontName||'Arial',fontSize:Number(f.size||f.fontSize)||20,description:f.description||'',plainText:!!f.plainText,collapsed:!!f.collapsed,excludeFromSearch:!!f.excludeFromSearch,tag:f.tag==null?null:Number(f.tag),preventDeletion:!!f.preventDeletion}));
    const templates=(m.tmpls||m.templates||[]).map((t,i)=>({name:t.name||('Card '+(i+1)),ord:i,sourceOrd:Number.isFinite(Number(t.ord))?Number(t.ord):i,qfmt:t.qfmt||'',afmt:t.afmt||'',bqfmt:t.bqfmt||'',bafmt:t.bafmt||'',did:t.did||null,bfont:t.bfont||'',bsize:Number(t.bsize)||0,id:t.id==null?null:Number(t.id)}));
    return {id:Number(m.id),ankiId:Number(m.id),originalId:m.originalId==null?Number(m.id):Number(m.originalId),name:m.name||'Imported',kind:Number(m.type)===1?'cloze':'normal',sortf:Math.max(0,Number(m.sortf)||0),did:m.did==null?null:Number(m.did),css:m.css||'',fields,templates,latexPre:m.latexPre||'',latexPost:m.latexPost||'',latexsvg:!!m.latexsvg,originalStockKind:Number(m.originalStockKind)||0,updatedAt:m.mod?new Date(Number(m.mod)*1000).toISOString():undefined,ankiMtime:m.mod?new Date(Number(m.mod)*1000).toISOString():undefined};
  },
  async inspectFile(file){
    const name=String(file&&file.name||'').toLowerCase();
    if(/\.(apkg|colpkg|zip)$/.test(name))return {kind:'anki-package',format:name.endsWith('.colpkg')||name==='collection.apkg'||/^backup-.*\.apkg$/.test(name)?'colpkg':'apkg',inspectionDeferred:true};
    if(/\.db$/.test(name))return {kind:'mnemosyne',inspectionDeferred:true};
    if(!/\.(txt|csv|tsv)$/.test(name))return null;
    if(!window.CardsOfficialBridge)throw new Error('Anki oficial indisponível.');
    const meta=await CardsOfficialBridge.officialCsvMetadata(file);
    return {kind:'text',metadata:meta,previewOnly:true,
      rows:(meta.preview||[]).map(row=>row.vals||[]),columns:meta.column_labels||[],
      isHtml:!!meta.is_html,headers:{html:!!meta.is_html},globalTags:meta.global_tags||[],
      globalDeck:meta.deck_name||'',globalNotetype:meta.global_notetype&&meta.global_notetype.id||'',
      deckColumn:meta.deck_column||0,notetypeColumn:meta.notetype_column||0,
      tagsColumn:meta.tags_column||0,guidColumn:meta.guid_column||0};
  }
};
