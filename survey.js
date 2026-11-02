(() => {
  'use strict';
  const endpoint = 'https://jscqmtdvbvjqynfveafj.supabase.co/rest/v1/investment_survey_responses';
  const publishableKey = 'sb_publishable_cpFhSQ2zghkcDmXRF9t8vQ_3utPbffg';
  const guestStorageKey = 'wealth-journal-survey-v1';
  let storageKey = guestStorageKey;
  const W = window.wealth;
  const fields = [
    ['experience', '投資經驗'],
    ['risk', '風險偏好'],
    ['investment_goal', '投資目標'],
    ['investment_horizon', '投資期間'],
    ['emergency_fund', '緊急預備金']
  ];
  const $ = selector => document.querySelector(selector);
  const form = $('#survey-form');
  const modal = $('#survey-modal');
  const status = $('#survey-status');
  const submit = form.querySelector('[type=submit]');
  let answer = null;
  let saving = false;
  let accountRevision = 0;
  let dirty = false;
  try { answer = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch {}
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) answer = null;
  form.addEventListener('change', () => { dirty = true; });

  function remember(value) {
    answer = value;
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
  }
  function render() {
    const complete = answer && fields.every(([name]) => answer[name]);
    $('#survey-result').textContent = answer
      ? fields.map(([name, label]) => `${label}：${answer[name] || '待補填'}`).join('　｜　')
        + `（${!complete ? '問卷已更新為五題，請補填後送出' : answer.syncedAt ? '已儲存至雲端' : '尚未儲存至雲端，請開啟問卷送出'}）`
      : '尚未填寫';
    $('#survey-open').textContent = answer ? '修改答案' : '填寫問卷';
  }
  function open() {
    dirty = false;
    form.reset();
    if (answer) {
      for (const [name] of fields) {
        const choice = Array.from(form.elements[name]).find(input => input.value === answer[name]);
        if (choice) choice.checked = true;
      }
    }
    status.textContent = '';
    modal.classList.add('open');
  }
  function close() { if (!saving) modal.classList.remove('open'); }
  $('#survey-open').onclick = open;
  $('#survey-nav').onclick = open;
  $('#survey-cancel').onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  async function loadAccount() {
    const revision = ++accountRevision;
    modal.classList.remove('open');
    storageKey = W.user ? guestStorageKey + ':' + W.user.id : guestStorageKey;
    try { answer = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { answer = null; }
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) answer = null;
    render();
    if (!W.user) return;
    try {
      const { data, error } = await W.client.from('investment_survey_responses').select('*').order('created_at', { ascending: false }).limit(1);
      if (revision !== accountRevision) return;
      if (error) throw error;
      if (data[0] && (!answer || answer.syncedAt)) {
        remember({ ...data[0], syncedAt: data[0].created_at });
        render();
        if (modal.classList.contains('open') && !dirty) open();
      }
    } catch { if (revision === accountRevision) $('#survey-result').textContent += '（雲端答案讀取失敗，可稍後重試）'; }
  }
  window.addEventListener('wealth-user-change', loadAccount);
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    const data = new FormData(form);
    const revision = accountRevision;
    const values = Object.fromEntries(fields.map(([name]) => [name, data.get(name)]));
    const sameAnswers = answer && fields.every(([name]) => answer[name] === values[name]);
    if (answer?.syncedAt && sameAnswers) {
      status.textContent = '這份答案已儲存至雲端。';
      close();
      return;
    }
    const id = answer?.id && !answer.syncedAt && sameAnswers
      ? answer.id : crypto.randomUUID();
    remember({ id, ...values });
    render();
    saving = true;
    submit.disabled = true;
    $('#survey-cancel').disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = '正在儲存至雲端…';
    try {
      const headers = { apikey: publishableKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
      if (W.user) {
        const { data, error } = await W.client.auth.getSession();
        if (error || !data.session) throw new Error('請重新登入');
        headers.Authorization = 'Bearer ' + data.session.access_token;
      }
      if (revision !== accountRevision) return;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, ...values }),
        signal: AbortSignal.timeout(15000)
      });
      // Retrying a request whose reply was lost uses the same UUID.
      const error = response.ok ? null : await response.json().catch(() => ({}));
      if (!response.ok && !(response.status === 409 && error.code === '23505')) throw new Error('Save failed');
      if (revision !== accountRevision) return;
      remember({ id, ...values, syncedAt: new Date().toISOString() });
      render();
      status.textContent = '答案已儲存至雲端。';
      modal.classList.remove('open');
    } catch {
      if (revision === accountRevision) status.textContent = '尚未儲存至雲端。答案已暫存在本頁，請確認網路後再次按「儲存答案」。';
    } finally {
      saving = false;
      submit.disabled = false;
      $('#survey-cancel').disabled = false;
      form.removeAttribute('aria-busy');
    }
  };
  render();
  if (W.ready) loadAccount();
})();
