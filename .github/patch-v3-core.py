from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path, old, new):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{path}: esperado 1 match, encontrado {n}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# 1) A hidratação inicial fazia um evento de IndexedDB por chave. Em perfis grandes,
# isso alongava o overlay "Carregando seus estudos". getAllKeys + getAll entrega o
# mesmo conteúdo em lote; cursor fica como fallback para navegadores antigos.
old_hydrate = '''  function hydrate() {
    return new Promise(function (resolve) {
      if (!db) { resolve(); return; }
      var tx, store, req;
      try { tx = db.transaction(IDB_STORE, 'readonly'); store = tx.objectStore(IDB_STORE); req = store.openCursor(); }
      catch (e) { resolve(); return; }
      req.onsuccess = function () {
        var cur = req.result;
        if (cur) { cache.set(String(cur.key), String(cur.value)); cur.continue(); }
        else { invalidateKeys(); resolve(); }
      };
      req.onerror = function () { resolve(); };
    });
  }
'''
new_hydrate = '''  function hydrateCursor(resolve) {
    var tx, store, req;
    try { tx = db.transaction(IDB_STORE, 'readonly'); store = tx.objectStore(IDB_STORE); req = store.openCursor(); }
    catch (e) { resolve(); return; }
    req.onsuccess = function () {
      var cur = req.result;
      if (cur) { cache.set(String(cur.key), String(cur.value)); cur.continue(); }
      else { invalidateKeys(); resolve(); }
    };
    req.onerror = function () { resolve(); };
  }
  function hydrate() {
    return new Promise(function (resolve) {
      if (!db) { resolve(); return; }
      var tx, store, rk, rv, keys = null, vals = null, settled = false;
      try {
        tx = db.transaction(IDB_STORE, 'readonly');
        store = tx.objectStore(IDB_STORE);
        if (typeof store.getAll !== 'function' || typeof store.getAllKeys !== 'function') {
          hydrateCursor(resolve); return;
        }
        rk = store.getAllKeys();
        rv = store.getAll();
      } catch (e) { hydrateCursor(resolve); return; }
      var fallback = function () {
        if (settled) return;
        settled = true;
        hydrateCursor(resolve);
      };
      var finish = function () {
        if (settled || keys === null || vals === null) return;
        settled = true;
        var n = Math.min(keys.length, vals.length);
        for (var i = 0; i < n; i++) cache.set(String(keys[i]), String(vals[i]));
        invalidateKeys();
        resolve();
      };
      rk.onsuccess = function () { keys = rk.result || []; finish(); };
      rv.onsuccess = function () { vals = rv.result || []; finish(); };
      rk.onerror = fallback;
      rv.onerror = fallback;
    });
  }
'''
replace_once('src/html/90-rodape.html', old_hydrate, new_hydrate)

# 2) A segunda abertura do IndexedDB não tratava "blocked". Nesse estado o
# Promise podia ficar pendurado indefinidamente e o spinner nunca saía.
old_block = '''      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
'''
new_block = '''      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB bloqueado por outra aba')); };
    });
  }
'''
replace_once('src/html/90-rodape.html', old_block, new_block)

# 3) Uma tentativa SILENCIOSA de renovar sessão não pode abrir formulário de
# senha sobre a tela. O menu só abre quando a pessoa pediu reconexão explicitamente.
old_reconnect = '''      } else {
        this.setBtn('error', 'Sessão expirada');
        if (loud) toast('Não deu para renovar a sessão. Entre com sua senha no menu ☁.');
        this.openMenu($('#cloud-sync-btn'), true);
      }
'''
new_reconnect = '''      } else {
        this.setBtn('error', 'Sessão expirada');
        if (loud) {
          toast('Não deu para renovar a sessão. Entre com sua senha no menu ☁.');
          this.openMenu($('#cloud-sync-btn'), true);
        }
      }
'''
replace_once('src/js/80-ajustes-finais.js', old_reconnect, new_reconnect)

# 4) Caso mais comum após login: mesma conta + mesmo perfil já hidratado localmente.
# Não espera listagem/hidratação da nuvem para mostrar o app. Abre o local em
# milissegundos e confere novidades em segundo plano; update real ainda usa a
# sincronização segura e só recarrega se houver dado novo.
old_auto = '''      const willAutoEnter = logged && this.autoEnterOn() && !this._autoEnterTried && !this._offline;
      if (loginEl) loginEl.style.display = 'none';
      if (willAutoEnter) {
        this._stage = 'entering';
        if (enteringEl) enteringEl.style.display = 'block';
        if (profilesEl) profilesEl.style.display = 'none';
        if (head) head.style.display = 'none';   // esconde "Quem vai estudar?"
        this.loadCloudProfiles();                 // vai auto-entrar (ou cair no picker)
      } else {
'''
new_auto = '''      const willAutoEnter = logged && this.autoEnterOn() && !this._autoEnterTried && !this._offline;
      if (loginEl) loginEl.style.display = 'none';
      if (willAutoEnter) {
        /* FAST PATH OFFLINE-FIRST: se o alvo desta conta já é exatamente o
           perfil ativo e os dados dele estão neste aparelho, não há motivo para
           deixar a pessoa olhando "Carregando seu perfil" enquanto uma consulta
           de rede confirma algo que já podemos mostrar com segurança. A nuvem é
           conferida logo depois, em segundo plano; novidade real continua usando
           o fluxo normal de pull protegido. */
        let localAlvo = this.getDefaultProfile() || this.getLastProfile();
        const ativoLocal = ProfileManager.getActiveProfileId();
        const uidAtual = this._uid();
        const podeAbrirLocal = localAlvo && localAlvo === ativoLocal && this._hasLocalData(localAlvo) &&
          (!ProfileManager._podeVerLocal || ProfileManager._podeVerLocal(localAlvo, uidAtual));
        if (podeAbrirLocal) {
          this._autoEnterTried = true;
          this._entering = false;
          try { sessionStorage.setItem(this.SESSION_KEY, localAlvo); } catch (e) { _quiet(e); }
          this.setLastProfile(localAlvo);
          if (enteringEl) enteringEl.style.display = 'none';
          if (profilesEl) profilesEl.style.display = 'none';
          this.hideGate();
          this.renderChip();
          try { DB.checarEspaco(); } catch (_) { _quiet(_); }
          setTimeout(() => { try { if (window.CloudStore) CloudStore.syncOnFocus(); } catch (_) { _quiet(_); } }, 120);
          return;
        }
        this._stage = 'entering';
        if (enteringEl) enteringEl.style.display = 'block';
        if (profilesEl) profilesEl.style.display = 'none';
        if (head) head.style.display = 'none';   // esconde "Quem vai estudar?"
        this.loadCloudProfiles();                 // vai auto-entrar (ou cair no picker)
      } else {
'''
replace_once('src/js/53-portao-de-acesso.js', old_auto, new_auto)

# 5) Spinners que são criados depois do evento screen:activated também ficam
# animados por CSS, sem depender do decorador encontrar o nó naquele instante.
p = ROOT / 'src/css/20-ux-stability-v3.css'
s = p.read_text(encoding='utf-8')
extra = '''\n/* Spinners tardios (criados depois da ativação da tela) também animam. */
#screen-conquistas [class*="spinner"],#screen-conquistas [class*="loading-spin"],
#screen-desempenhotec [class*="spinner"],#screen-desempenhotec [class*="loading-spin"]{
  animation:uxv3-spin .78s linear infinite!important;will-change:transform;transform:translateZ(0);
}\n'''
if extra.strip() not in s:
    p.write_text(s + extra, encoding='utf-8')

print('patch-v3-core aplicado')
