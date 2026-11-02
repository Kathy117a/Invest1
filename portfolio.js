(() => {
  'use strict';
  const W = window.wealth;
  const notice = $('#sync-status');
  let loaded = false, loadingRevision = 0, quoteRun = 0, creating = false, importing = false;
  let pendingAsset = null;
  const localKey = 'wealth-journal-v1';
  function readLocal() { try { const value = JSON.parse(localStorage.getItem(localKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  function updateImport() { $('#import-local').hidden = !W.user || !loaded || !readLocal().length; }
  function fromRow(row) {
    return { id: row.id, name: row.name, type: row.type, symbol: row.symbol,
      buyPrice: Number(row.buy_price), quantity: Number(row.quantity), cost: Number(row.buy_price) * Number(row.quantity),
      investDate: row.invest_date, note: row.note, value: null };
  }
  async function loadAssets() {
    const revision = W.revision, run = ++loadingRevision;
    if (!W.user) return;
    loaded = false; $('#sync-retry').hidden = true;
    notice.textContent = '正在載入你的雲端資產…';
    try {
      const { data, error } = await W.client.from('assets').select('*').order('created_at');
      if (revision !== W.revision || run !== loadingRevision) return;
      if (error) throw error;
      items = data.map(fromRow); loaded = true; render(); updateImport();
      notice.textContent = '資產已與雲端同步。';
      await refreshQuotes();
    } catch {
      if (revision !== W.revision || run !== loadingRevision) return;
      notice.textContent = '資產載入失敗，請確認網路後重試。'; $('#sync-retry').hidden = false;
    }
  }
  function accountChanged() {
    loaded = false; loadingRevision++; quoteRun++; pendingAsset = null;
    items = []; render(); updateImport();
    $('#modal').classList.remove('open'); $('#form').reset(); updateForm();
    helperBody.textContent = '';
    helperMessage('登入後，可查詢上市股票、ETF 與你的資產概況。');
    $('#quote-status').textContent = '報價來源：臺灣證交所、投信投顧公會；非即時行情。';
    $('#sync-retry').hidden = true;
    if (W.user) loadAssets();
    else notice.textContent = '登入後即可新增、同步個人資產。原有本機紀錄仍保留，可於登入後匯入。';
  }
  window.addEventListener('wealth-user-change', accountChanged);
  $('#sync-retry').onclick = loadAssets;
  $('#add').onclick = () => {
    if (!W.requireLogin()) return;
    if (!loaded) { notice.textContent = '請先完成資產載入，再新增紀錄。'; return; }
    $('#asset-status').textContent = '';
    $('#modal').classList.add('open'); $('#form input').focus();
  };
  $('#cancel').onclick = () => { if (!creating) $('#modal').classList.remove('open'); };
  $('#modal').onclick = event => { if (event.target.id === 'modal' && !creating) event.target.classList.remove('open'); };
  $('#form').onsubmit = async event => {
    event.preventDefault();
    if (creating || !W.requireLogin() || !loaded || !event.target.reportValidity()) return;
    const revision = W.revision, button = $('#form [type=submit]');
    const data = new FormData(event.target);
    const values = { name: data.get('name'), type: data.get('type'), symbol: data.get('symbol'), buyPrice: data.get('buyPrice'), quantity: data.get('quantity'), investDate: data.get('investDate'), note: data.get('note') };
    const fingerprint = JSON.stringify(values);
    creating = true; button.disabled = true;
    $('#asset-status').textContent = '正在儲存至雲端…';
    try {
      if (!pendingAsset || pendingAsset.fingerprint !== fingerprint) pendingAsset = { fingerprint, id: crypto.randomUUID() };
      const record = W.assetRecord(values, pendingAsset.id);
      const { error } = await W.client.from('assets').insert(record);
      if (error && error.code !== '23505') throw error;
      if (revision !== W.revision) return;
      pendingAsset = null; event.target.reset(); updateForm(); $('#modal').classList.remove('open');
      await loadAssets();
    } catch (error) {
      if (revision === W.revision) $('#asset-status').textContent = error instanceof Error ? error.message : '未能儲存，請確認網路後再次送出。';
    } finally { creating = false; button.disabled = false; }
  };
  $('#rows').onclick = async event => {
    const button = event.target.closest('[data-i]');
    if (!button || button.disabled || !W.user || !loaded) return;
    const item = items[Number(button.dataset.i)], revision = W.revision;
    if (!item || !confirm('確定刪除「' + item.name + '」的資產紀錄？')) return;
    button.disabled = true;
    try {
      const { error } = await W.client.from('assets').delete().eq('id', item.id);
      if (error) throw error;
      if (revision !== W.revision) return;
      items = items.filter(row => row.id !== item.id); quoteRun++; render();
      notice.textContent = '資產紀錄已從雲端刪除。';
    } catch { if (revision === W.revision) notice.textContent = '刪除失敗，紀錄仍保留，請稍後再試。'; }
    finally { button.disabled = false; }
  };
  $('#import-local').onclick = async () => {
    if (importing || !W.user || !loaded) return;
    const legacy = readLocal(), revision = W.revision, userId = W.user.id;
    if (!legacy.length) return;
    if (!confirm('將此瀏覽器的 ' + legacy.length + ' 筆資產匯入目前帳戶？本機原始紀錄會保留。')) return;
    importing = true; $('#import-local').disabled = true;
    try {
      const mappingKey = 'wealth-import-ids-' + userId;
      let mapping; try { mapping = JSON.parse(localStorage.getItem(mappingKey) || '{}'); } catch { mapping = {}; }
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) mapping = {};
      const records = [], invalid = [];
      legacy.forEach((item, index) => {
        const fingerprint = index + ':' + JSON.stringify(item);
        mapping[fingerprint] ||= crypto.randomUUID();
        try { records.push(W.assetRecord(item, mapping[fingerprint])); } catch { invalid.push(item.name || '第 ' + (index + 1) + ' 筆'); }
      });
      // Persist stable IDs before any network write, so a retry never duplicates a batch.
      localStorage.setItem(mappingKey, JSON.stringify(mapping));
      const existing = new Set(items.map(item => item.id));
      const fresh = records.filter(record => !existing.has(record.id));
      if (fresh.length) {
        const { error } = await W.client.from('assets').insert(fresh);
        if (error) throw error;
      }
      if (revision !== W.revision) return;
      await loadAssets();
      if (revision !== W.revision) return;
      notice.textContent = (fresh.length ? '已匯入 ' + fresh.length + ' 筆資產。' : '完整的本機紀錄已匯入，未重複新增。')
        + (invalid.length ? '以下紀錄缺少必要欄位，仍保留於本機，請手動新增：' + invalid.join('、') : '本機原始紀錄已保留。');
    } catch { if (revision === W.revision) { notice.textContent = '匯入未完成，本機原始紀錄仍保留。請先重新載入雲端資產，再重試。'; $('#sync-retry').hidden = false; } }
    finally { importing = false; $('#import-local').disabled = false; }
  };
  refreshQuotes = async () => {
    if (!W.user || !loaded) { W.requireLogin(); return; }
    const revision = W.revision, run = ++quoteRun, status = $('#quote-status');
    $('#refresh').disabled = true;
    status.textContent = '正在取得雲端收盤價與基金淨值…';
    const messages = [];
    try {
      for (const type of [{ fund: false, kind: 'quotes' }, { fund: true, kind: 'funds' }]) {
        const targets = items.filter(item => (item.type === '基金') === type.fund);
        if (!targets.length) continue;
        try {
          const result = await W.marketData(type.kind);
          if (revision !== W.revision || run !== quoteRun) return;
          let found = 0; const missing = [];
          for (const item of targets) {
            const quote = result.data.find(row => type.fund ? row.code === item.symbol && row.currency === 'TWD' : row.Code === item.symbol);
            const price = quote && Number(String(type.fund ? quote.price : quote.ClosingPrice).replace(/,/g, ''));
            if (Number.isFinite(price) && price > 0) {
              item.value = price * item.quantity; item.quotePrice = price;
              item.quoteDate = type.fund ? quote.date : quote.Date; found++;
            } else { item.value = null; delete item.quotePrice; delete item.quoteDate; missing.push(item.symbol); }
          }
          messages.push((type.fund ? '基金' : '股票') + '取得 ' + found + ' 筆報價'
            + (missing.length ? '，查無新台幣報價：' + missing.join('、') : '')
            + (result.stale ? '（來源暫時無法更新，使用上次快取）' : '')
            + '，資料擷取：' + new Date(result.fetched_at).toLocaleString('zh-TW'));
        } catch { if (revision !== W.revision || run !== quoteRun) return; messages.push((type.fund ? '基金' : '股票') + '報價取得失敗，保留本頁上次市值'); }
      }
      if (revision !== W.revision || run !== quoteRun) return;
      render(); status.textContent = (messages.join('；') || '尚無需要更新的資產') + '。來源：臺灣證交所、投信投顧公會，非即時行情；各筆報價日期顯示於資產下方。';
    } finally { if (run === quoteRun || revision !== W.revision) $('#refresh').disabled = false; }
  };
  $('#refresh').onclick = refreshQuotes;
  setInterval(() => { if (W.user && loaded && items.length && !document.hidden) refreshQuotes(); }, 15 * 60 * 1000);
  window.addEventListener('focus', () => { if (W.user && loaded) loadAssets(); });
  if (W.ready) accountChanged();
})();
