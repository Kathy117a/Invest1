(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const url = 'https://jscqmtdvbvjqynfveafj.supabase.co';
  const key = 'sb_publishable_cpFhSQ2zghkcDmXRF9t8vQ_3utPbffg';
  const client = window.supabase.createClient(url, key);
  const state = window.wealth = { client, user: null, ready: false, revision: 0, marketData, requireLogin, assetRecord };
  let mode = 'login', busy = false;
  const form = $('#auth-form'), modal = $('#auth-modal'), message = $('#auth-status');
  function requireLogin() {
    if (state.user) return true;
    message.textContent = '登入後即可同步個人資產與取得雲端報價。';
    modal.classList.add('open');
    return false;
  }
  function setMode(next) {
    mode = next;
    $('#auth-title').textContent = mode === 'signup' ? '建立會員帳戶' : '會員登入';
    $('#auth-submit').textContent = mode === 'signup' ? '註冊' : '登入';
    $('#auth-switch').textContent = mode === 'signup' ? '已有帳戶？前往登入' : '還沒有帳戶？建立會員';
    $('#auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('#auth-password').minLength = mode === 'signup' ? 8 : 1;
    message.textContent = '';
  }
  $('#login-open').onclick = () => { setMode('login'); modal.classList.add('open'); };
  $('#auth-switch').onclick = () => { if (!busy) setMode(mode === 'login' ? 'signup' : 'login'); };
  $('#auth-close').onclick = () => { if (!busy) modal.classList.remove('open'); };
  modal.onclick = event => { if (event.target === modal && !busy) modal.classList.remove('open'); };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; $('#auth-submit').disabled = true; $('#auth-switch').disabled = true;
    message.textContent = mode === 'signup' ? '正在建立帳戶…' : '正在登入…';
    try {
      const credentials = { email: $('#auth-email').value.trim(), password: $('#auth-password').value };
      const result = mode === 'signup' ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      $('#auth-password').value = '';
      if (result.data.session) { modal.classList.remove('open'); message.textContent = ''; }
      else message.textContent = '請至信箱開啟驗證信，完成驗證後回到此頁登入。';
    } catch (error) {
      const messages = {
        invalid_credentials: 'Email 或密碼不正確，請重新輸入。',
        email_not_confirmed: '請先開啟信箱中的驗證信，再回來登入。',
        user_already_exists: '此 Email 已註冊，請改用登入。',
        weak_password: '密碼強度不足，請使用較長並包含不同字元的密碼。',
        over_email_send_rate_limit: '驗證信寄送次數已達上限，請稍後再試。',
        email_address_not_authorized: '目前寄信服務只允許已授權的信箱，請聯絡網站管理者設定寄信服務。',
      };
      message.textContent = messages[error.code] || '目前無法完成，請確認網路及輸入內容後再試。';
    } finally { busy = false; $('#auth-submit').disabled = false; $('#auth-switch').disabled = false; }
  };
  $('#logout').onclick = async () => {
    $('#logout').disabled = true;
    const { error } = await client.auth.signOut({ scope: 'local' });
    $('#logout').disabled = false;
    if (error) $('#sync-status').textContent = '登出失敗，請確認網路後再試。';
  };
  function changeUser(session) {
    const user = session?.user || null;
    if (state.ready && state.user?.id === user?.id) return;
    state.ready = true; state.user = user; state.revision++;
    $('#member-email').textContent = user ? user.email : '訪客';
    $('#login-open').hidden = !!user; $('#logout').hidden = !user;
    window.dispatchEvent(new CustomEvent('wealth-user-change', { detail: user }));
  }
  client.auth.onAuthStateChange((_event, session) => { changeUser(session); });
  // Deferring initialization lets the portfolio and survey attach their listeners first.
  setTimeout(async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      changeUser(data.session);
    } catch { changeUser(null); $('#sync-status').textContent = '目前無法恢復登入，請重新登入。'; }
  }, 0);
  async function marketData(kind) {
    if (!state.user) throw Error('請先登入');
    const { data, error } = await client.functions.invoke('market-data', { body: { kind } });
    if (error || !Array.isArray(data?.data)) throw Error(data?.error || '行情服務暫時無法連線');
    return data;
  }
  function assetRecord(item, id = crypto.randomUUID()) {
    const record = {
      id, name: String(item.name || '').trim(), type: item.type,
      symbol: String(item.symbol || '').trim().toUpperCase(),
      buy_price: Number(item.buyPrice), quantity: Number(item.quantity),
      invest_date: item.investDate, note: String(item.note || '')
    };
    if (!record.name || record.name.length > 60 || !['股票', 'ETF', '基金'].includes(record.type)
      || !/^[A-Z0-9]{1,20}$/.test(record.symbol) || !Number.isFinite(record.buy_price) || record.buy_price <= 0 || record.buy_price >= 1e15
      || !Number.isFinite(record.quantity) || record.quantity <= 0 || record.quantity >= 1e15
      || !/^\d{4}-\d{2}-\d{2}$/.test(record.invest_date || '') || record.note.length > 80) {
      throw Error('資產資料不完整，請確認名稱、代號、買入單價、數量與投資日期。');
    }
    return record;
  }
})();
