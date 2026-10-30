/**
 * 店长后台前端逻辑（原生 JS，无框架，方便直接修改）
 * 四大模块：桌台看板 / 商品管理 / 订单管理 / 账单查询
 * 新订单提醒：每 8 秒轮询一次 /api/notify/new-orders，有声音 + 角标 + 右下角弹窗
 */

/* ================= 常量与工具 ================= */

// 与后端 server/routes/*.js 中的定义保持一致
const ROOM_TYPES  = { standard: '标准间', deluxe: '豪华间', vip: 'VIP包间' };
const CATEGORIES  = { cigarette: '香烟', drink: '饮料', snack: '零食', other: '其他' };
const PAY_METHODS = { cash: '现金', wechat: '微信', alipay: '支付宝', card: '刷卡' };
const ORDER_STATUS = {
  pending:   { text: '待处理', cls: 'st-pending' },
  confirmed: { text: '已确认', cls: 'st-confirmed' },
  cancelled: { text: '已取消', cls: 'st-cancelled' },
  settled:   { text: '已结账', cls: 'st-settled' },
};

let token = localStorage.getItem('adminToken') || '';
let soundOn = localStorage.getItem('soundOn') !== '0';   // 声音提醒开关
let lastOrderId = Number(localStorage.getItem('lastOrderId') || 0); // 已见过的最大订单id
let unseenCount = 0;                 // 未查看的新订单数（铃铛角标）
let firstPoll = true;                // 首次轮询只记录基线，不弹提醒

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const money = (n) => '¥' + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 时间显示：ISO 字符串 → 本地时间
function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
// 开台时长显示：如 "2小时35分"
function fmtDur(openedAt) {
  if (!openedAt) return '-';
  const mins = Math.max(0, Math.round((Date.now() - new Date(openedAt).getTime()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分` : `${mins}分钟`;
}
function todayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ================= API 请求封装 ================= */

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers['x-admin-token'] = token;
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) { showLogin(); throw new Error(data.error || '请先登录'); }
  if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
  return data;
}

/* ================= 弹窗 / 通知 ================= */

function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalMask').classList.remove('hidden');
}
function closeModal() { $('#modalMask').classList.add('hidden'); }
$('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') closeModal(); });

// 右下角 toast 通知
function toast(msg, onClick) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = msg;
  if (onClick) el.style.cursor = 'pointer';
  el.addEventListener('click', () => { onClick && onClick(); el.remove(); });
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// "叮"一声提醒（WebAudio 合成，无需音频文件）
function beep() {
  if (!soundOn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, start, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.25, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
    };
    play(880, 0, 0.25); play(1174, 0.28, 0.4); // 两声上行音，更像"叮咚"
  } catch (_) { /* 浏览器未允许播放时忽略 */ }
}

function setBadge(n) {
  unseenCount = n;
  const b = $('#bellBadge'), ob = $('#ordersBadge');
  b.textContent = ob.textContent = n;
  b.classList.toggle('hidden', !n);
  ob.classList.toggle('hidden', !n);
}

/* ================= 登录 / 退出 ================= */

function showLogin() {
  $('#loginMask').classList.remove('hidden');
  $('#loginPwd').focus();
}
async function doLogin() {
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#loginPwd').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    token = data.token;
    localStorage.setItem('adminToken', token);
    $('#loginMask').classList.add('hidden');
    initApp();
  } catch (e) { alert(e.message); }
}
$('#loginBtn').addEventListener('click', doLogin);
$('#loginPwd').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST', auth: true }); } catch (_) {}
  token = ''; localStorage.removeItem('adminToken'); showLogin();
});
$('#soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('soundOn', soundOn ? '1' : '0');
  $('#soundBtn').textContent = soundOn ? '🔊' : '🔇';
});
$('#bellBtn').addEventListener('click', () => { setBadge(0); switchTab('orders'); });

/* ================= 页签切换 ================= */

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-page').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
  // 切到对应页签时刷新数据
  if (name === 'tables')   renderTables();
  if (name === 'products') renderProducts();
  if (name === 'orders')   renderOrders();
  if (name === 'bills')    renderBills();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

/* ================= 模块一：桌台看板 ================= */

async function renderTables() {
  const el = $('#tab-tables');
  try {
    const tables = await api('/tables', { auth: false });
    window._tables = tables; // 缓存供 onclick 处理器按 id 查找（避免名称里的引号破坏内联 JS）
    el.innerHTML = `
      <div class="toolbar">
        <h2>桌台看板 <small class="muted">共 ${tables.length} 桌，使用中 ${tables.filter(t => t.status === 'occupied').length} 桌</small></h2>
        <div>
          <button class="btn" onclick="openQrcodeModal()">🖨 桌码</button>
          <button class="btn primary" onclick="openTableForm()">＋ 新增桌台</button>
        </div>
      </div>
      <div class="table-grid">
        ${tables.map(tableCard).join('')}
      </div>`;
  } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

function tableCard(t) {
  const occ = t.status === 'occupied';
  return `
  <div class="tcard ${occ ? 'occupied' : 'idle'}">
    <div class="tcard-head">
      <span class="tname">${esc(t.name)}</span>
      <span class="ttype">${ROOM_TYPES[t.room_type] || t.room_type}</span>
    </div>
    <div class="trate">${money(t.hourly_rate)}/小时 · 最低${t.min_hours}小时</div>
    ${occ
      ? `<div class="tinfo">👤 ${esc(t.customer_name || '未填')}<br>⏱ 已开 ${fmtDur(t.opened_at)}</div>
         <div class="tcard-btns">
           <button class="btn danger" onclick="openCloseModal(${t.id})">结桌</button>
           <button class="btn" onclick="openTableForm(${t.id})">编辑</button>
         </div>`
      : `<div class="tinfo muted">空闲中</div>
         <div class="tcard-btns">
           <button class="btn primary" onclick="openOpenModal(${t.id})">开台</button>
           <button class="btn" onclick="openTableForm(${t.id})">编辑</button>
           <button class="btn" onclick="deleteTable(${t.id})">删除</button>
         </div>`}
  </div>`;
}

// 新增/编辑桌台表单（id 为空 = 新增）
async function openTableForm(id) {
  let t = { name: '', room_type: 'standard', hourly_rate: 20, min_hours: 1, remark: '' };
  if (id) t = await api('/tables/' + id, { auth: false });
  openModal(`
    <h3>${id ? '编辑桌台 ' + esc(t.name) : '新增桌台'}</h3>
    <label>桌台名 *<input id="f-tname" value="${esc(t.name)}" placeholder="如 A1、大厅2号"></label>
    <label>房型
      <select id="f-ttype">${Object.entries(ROOM_TYPES).map(([k, v]) =>
        `<option value="${k}" ${t.room_type === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>
    <label>桌费费率（元/小时）*<input id="f-trate" type="number" min="0.01" step="0.5" value="${t.hourly_rate}"></label>
    <label>最低消费时长（小时）<input id="f-tmin" type="number" min="0" step="0.5" value="${t.min_hours}"></label>
    <label>备注<input id="f-tremark" value="${esc(t.remark || '')}"></label>
    <div class="modal-btns">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="saveTable(${id || 'null'})">保存</button>
    </div>`);
}
async function saveTable(id) {
  const body = {
    name: $('#f-tname').value.trim(),
    room_type: $('#f-ttype').value,
    hourly_rate: Number($('#f-trate').value),
    min_hours: Number($('#f-tmin').value),
    remark: $('#f-tremark').value,
  };
  try {
    if (id) await api('/tables/' + id, { method: 'PUT', body });
    else    await api('/tables', { method: 'POST', body });
    closeModal(); renderTables();
  } catch (e) { alert(e.message); }
}
async function deleteTable(id) {
  const t = (window._tables || []).find((x) => x.id === id);
  if (!confirm(`确定删除桌台「${t ? t.name : id}」吗？`)) return;
  try { await api('/tables/' + id, { method: 'DELETE' }); renderTables(); }
  catch (e) { alert(e.message); }
}

/* ---------- 每桌小程序码（上线后打印贴桌） ---------- */
async function openQrcodeModal(env = 'release') {
  const tables = window._tables || [];
  openModal(`
    <h3>每桌小程序码</h3>
    <p class="tip">打印后贴到对应桌台，顾客扫码直达该桌点单页。生成前提：服务器已配置 WX_APPID/WX_SECRET，且所选版本的小程序已发布（体验版码仅体验成员可扫）。</p>
    <div class="qr-switch">
      <button class="btn sm ${env === 'release' ? 'primary' : ''}" onclick="openQrcodeModal('release')">正式版码</button>
      <button class="btn sm ${env === 'trial' ? 'primary' : ''}" onclick="openQrcodeModal('trial')">体验版码</button>
      <button class="btn sm" onclick="printQrcodes()">🖨 打印整页</button>
    </div>
    <div id="qrGrid" class="qr-grid"><p class="muted">生成中…</p></div>
    <div class="modal-btns">
      <button class="btn" onclick="closeModal()">关闭</button>
    </div>`);
  const grid = $('#qrGrid');
  try {
    const items = await Promise.all(tables.map(async (t) => {
      const res = await fetch(`/api/wx/table-qrcode?name=${encodeURIComponent(t.name)}&env=${env}`,
        { headers: { 'x-admin-token': token } });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return { name: t.name, error: d.error || `请求失败(${res.status})` };
      }
      return { name: t.name, url: URL.createObjectURL(await res.blob()) };
    }));
    window._qrItems = items;
    grid.innerHTML = items.map((it) => it.error
      ? `<div class="qr-cell"><b>${esc(it.name)}</b><p class="muted">${esc(it.error)}</p></div>`
      : `<div class="qr-cell"><img src="${it.url}" alt="${esc(it.name)}"><b>${esc(it.name)}</b><span class="muted">扫码点单</span></div>`
    ).join('');
  } catch (e) { grid.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// 打印桌码页：把已生成的二维码放进 #printArea 走浏览器打印（@media print 只打印该区域）
function printQrcodes() {
  const items = (window._qrItems || []).filter((it) => it.url);
  if (!items.length) return alert('没有生成成功的小程序码可打印');
  $('#printArea').innerHTML = `
    <h2>扫码点单 · 每桌小程序码</h2>
    <div class="qr-print-grid">
      ${items.map((it) => `<div class="qr-print-cell"><img src="${it.url}"><b>${esc(it.name)}</b><span>扫码点单</span></div>`).join('')}
    </div>`;
  window.print();
}

// 开台弹窗
function openOpenModal(id) {
  const t = (window._tables || []).find((x) => x.id === id);
  const name = t ? t.name : '';
  openModal(`
    <h3>开台 · ${esc(name)}</h3>
    <label>顾客称呼（可空）<input id="f-cname" placeholder="如 王先生"></label>
    <label>开台备注（可空，结桌时并入账单备注）<input id="f-oremark"></label>
    <p class="tip">开台后立即开始按该桌费率计桌费；顾客也可在手机端自助开台。</p>
    <div class="modal-btns">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="doOpenTable(${id})">确认开台</button>
    </div>`);
}
async function doOpenTable(id) {
  try {
    await api(`/tables/${id}/open`, {
      method: 'POST', auth: false,
      body: { customer_name: $('#f-cname').value, remark: $('#f-oremark').value },
    });
    closeModal(); renderTables();
  } catch (e) { alert(e.message); }
}

/* ---------- 结桌（含账单预览） ---------- */

async function openCloseModal(tableId) {
  let pv;
  try { pv = await api(`/tables/${tableId}/bill-preview`); }
  catch (e) { return alert(e.message); }

  openModal(`
    <h3>结桌 · ${esc(pv.table.name)}</h3>
    ${pv.pendingCount > 0 ? `<p class="warn">⚠ 该桌还有 ${pv.pendingCount} 笔待处理订单未计入，请先到「订单管理」确认或取消</p>` : ''}
    <table class="kv">
      <tr><td>开台时间</td><td>${fmtTime(pv.table.opened_at)}</td></tr>
      <tr><td>实际时长</td><td>${Math.floor(pv.minutes / 60)}小时${pv.minutes % 60}分（计费 ${pv.billedHours} 小时 × ${money(pv.hourlyRate)}）</td></tr>
      <tr><td>桌费</td><td>${money(pv.tableFee)}</td></tr>
      <tr><td>商品费（${pv.orders.length} 笔订单）</td><td>${money(pv.goodsFee)}</td></tr>
      <tr class="total"><td>应收合计</td><td>${money(pv.total)}</td></tr>
    </table>
    <label>优惠金额（元）<input id="f-disc" type="number" min="0" step="1" value="0"
      oninput="$('#f-pay').value = Math.max(0, (${pv.total} - Number(this.value || 0))).toFixed(2)"></label>
    <label>实收金额（元）<input id="f-pay" type="text" value="${pv.total.toFixed(2)}" readonly></label>
    <label>收款方式
      <select id="f-pm">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </label>
    <label>备注<input id="f-cremark"></label>
    <div class="modal-btns">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn danger" onclick="doCloseTable(${tableId})">确认结桌并生成账单</button>
    </div>`);
}
async function doCloseTable(tableId) {
  try {
    const { bill } = await api(`/tables/${tableId}/close`, {
      method: 'POST',
      body: { discount: Number($('#f-disc').value) || 0, pay_method: $('#f-pm').value, remark: $('#f-cremark').value },
    });
    closeModal(); renderTables();
    // 结桌成功后直接显示账单并提供打印
    showBillModal(bill.id);
    toast(`✅ 桌台 ${esc(bill.table_name)} 已结桌，实收 ${money(bill.pay_amount)}`);
  } catch (e) { alert(e.message); }
}

/* ================= 模块二：商品管理 ================= */

let prodFilter = 'all';
async function renderProducts() {
  const el = $('#tab-products');
  try {
    const list = await api('/products?all=1');
    window._products = list; // 缓存供 onclick 处理器按 id 查找
    const shown = prodFilter === 'all' ? list : list.filter((p) => p.category === prodFilter);
    el.innerHTML = `
      <div class="toolbar">
        <h2>商品管理 <small class="muted">共 ${list.length} 种商品</small></h2>
        <div>
          <select onchange="prodFilter = this.value; renderProducts()">
            <option value="all" ${prodFilter === 'all' ? 'selected' : ''}>全部分类</option>
            ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${prodFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <button class="btn primary" onclick="openProductForm()">＋ 新增商品</button>
        </div>
      </div>
      <table class="list">
        <thead><tr><th>ID</th><th>名称</th><th>分类</th><th>单价</th><th>库存</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${shown.map((p) => `
            <tr class="${p.is_active ? '' : 'row-off'}">
              <td>${p.id}</td>
              <td>${esc(p.name)}</td>
              <td>${CATEGORIES[p.category] || p.category}</td>
              <td>${money(p.price)}</td>
              <td>${p.stock < 0 ? '不限量' : p.stock}</td>
              <td>${p.is_active ? '<span class="tag st-confirmed">上架</span>' : '<span class="tag st-cancelled">下架</span>'}</td>
              <td>
                <button class="btn sm" onclick="openProductForm(${p.id})">编辑</button>
                <button class="btn sm" onclick="toggleProduct(${p.id}, ${p.is_active ? 0 : 1})">${p.is_active ? '下架' : '上架'}</button>
                <button class="btn sm danger" onclick="deleteProduct(${p.id})">删除</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

async function openProductForm(id) {
  let p = { name: '', category: 'drink', price: '', stock: -1, is_active: 1, remark: '' };
  if (id) p = await api('/products/' + id, { auth: false });
  openModal(`
    <h3>${id ? '编辑商品' : '新增商品'}</h3>
    <label>商品名 *<input id="f-pname" value="${esc(p.name)}" placeholder="如 红牛 250ml"></label>
    <label>分类
      <select id="f-pcat">${Object.entries(CATEGORIES).map(([k, v]) =>
        `<option value="${k}" ${p.category === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>
    <label>单价（元）*<input id="f-pprice" type="number" min="0" step="0.5" value="${p.price}"></label>
    <label>库存<input id="f-pstock" type="number" min="-1" step="1" value="${p.stock}">
      <small class="muted">填 -1 表示不限量</small></label>
    <label><input id="f-pactive" type="checkbox" ${p.is_active ? 'checked' : ''}> 上架（顾客端可见）</label>
    <label>备注<input id="f-premark" value="${esc(p.remark || '')}"></label>
    <div class="modal-btns">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="saveProduct(${id || 'null'})">保存</button>
    </div>`);
}
async function saveProduct(id) {
  const body = {
    name: $('#f-pname').value.trim(),
    category: $('#f-pcat').value,
    price: Number($('#f-pprice').value),
    stock: Number($('#f-pstock').value),
    is_active: $('#f-pactive').checked ? 1 : 0,
    remark: $('#f-premark').value,
  };
  try {
    if (id) await api('/products/' + id, { method: 'PUT', body });
    else    await api('/products', { method: 'POST', body });
    closeModal(); renderProducts();
  } catch (e) { alert(e.message); }
}
async function toggleProduct(id, isActive) {
  try { await api('/products/' + id, { method: 'PUT', body: { is_active: isActive } }); renderProducts(); }
  catch (e) { alert(e.message); }
}
async function deleteProduct(id) {
  const p = (window._products || []).find((x) => x.id === id);
  if (!confirm(`确定删除商品「${p ? p.name : id}」吗？\n（历史订单已做快照，不受影响）`)) return;
  try { await api('/products/' + id, { method: 'DELETE' }); renderProducts(); }
  catch (e) { alert(e.message); }
}

/* ================= 模块三：订单管理 ================= */

let orderFilter = 'pending'; // 默认显示待处理
async function renderOrders() {
  const el = $('#tab-orders');
  try {
    const list = await api(`/orders?status=${orderFilter}&limit=100`);
    el.innerHTML = `
      <div class="toolbar">
        <h2>订单管理</h2>
        <select onchange="orderFilter = this.value; renderOrders()">
          ${[['pending','待处理'],['confirmed','已确认'],['settled','已结账'],['cancelled','已取消'],['all','全部']]
            .map(([k, v]) => `<option value="${k}" ${orderFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      ${list.length === 0 ? '<p class="muted">暂无订单</p>' : list.map(orderCard).join('')}`;
  } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

function orderCard(o) {
  const st = ORDER_STATUS[o.status] || { text: o.status, cls: '' };
  return `
  <div class="ocard">
    <div class="ocard-head">
      <b>桌台 ${esc(o.table_name)}</b>
      <span class="tag ${st.cls}">${st.text}</span>
      <span class="muted">${o.order_no} · ${fmtTime(o.created_at)}</span>
      <span class="oamount">${money(o.total_amount)}</span>
    </div>
    <ul class="oitems">
      ${o.items.map((it) => `<li>${esc(it.product_name)} × ${it.quantity} <span class="muted">${money(it.subtotal)}</span></li>`).join('')}
    </ul>
    ${o.remark ? `<div class="muted">备注：${esc(o.remark)}</div>` : ''}
    ${o.status === 'pending' ? `
      <div class="ocard-btns">
        <button class="btn primary sm" onclick="confirmOrder(${o.id})">✔ 确认接单</button>
        <button class="btn danger sm" onclick="cancelOrder(${o.id})">✖ 取消订单</button>
      </div>` : ''}
    ${o.status === 'confirmed' ? `
      <div class="ocard-btns">
        <button class="btn danger sm" onclick="cancelOrder(${o.id})">✖ 取消订单（恢复库存）</button>
      </div>` : ''}
  </div>`;
}
async function confirmOrder(id) {
  try {
    await api(`/orders/${id}/confirm`, { method: 'POST' });
    renderOrders(); refreshInProgress(); toast('已确认订单');
  }
  catch (e) { alert(e.message); }
}
async function cancelOrder(id) {
  if (!confirm('确定取消该订单吗？库存将自动恢复。')) return;
  try { await api(`/orders/${id}/cancel`, { method: 'POST' }); renderOrders(); refreshInProgress(); }
  catch (e) { alert(e.message); }
}

/* ================= 模块四：账单查询 ================= */

let billDate = todayStr();
async function renderBills() {
  const el = $('#tab-bills');
  try {
    const [list, stats] = await Promise.all([
      api(`/bills?date=${billDate}`),
      api(`/bills/stats/today?date=${billDate}`),
    ]);
    el.innerHTML = `
      <div class="toolbar">
        <h2>账单查询</h2>
        <div>
          <input type="date" id="billDateInput" value="${billDate === 'all' ? '' : billDate}" onchange="billDate = this.value || '${todayStr()}'; renderBills()">
          <button class="btn sm" onclick="billDate = 'all'; renderBills()">全部</button>
        </div>
      </div>
      <div id="billsInProgress" class="ip-section"></div>
      <div class="stat-cards">
        <div class="stat"><b>${money(stats.total_pay)}</b><span>实收合计</span></div>
        <div class="stat"><b>${stats.bill_count}</b><span>结桌笔数</span></div>
        <div class="stat"><b>${money(stats.total_table_fee)}</b><span>桌费收入</span></div>
        <div class="stat"><b>${money(stats.total_goods_fee)}</b><span>商品收入</span></div>
        <div class="stat"><b>${money(stats.total_discount)}</b><span>优惠合计</span></div>
      </div>
      ${stats.by_method.length ? `<p class="muted">收款方式：${stats.by_method.map(m => `${PAY_METHODS[m.pay_method] || m.pay_method} ${money(m.amount)}(${m.cnt}笔)`).join('　')}</p>` : ''}
      <table class="list">
        <thead><tr><th>账单号</th><th>桌台</th><th>开台</th><th>结桌</th><th>时长</th><th>桌费</th><th>商品费</th><th>应收</th><th>优惠</th><th>实收</th><th>收款</th><th>操作</th></tr></thead>
        <tbody>
          ${list.map((b) => `
            <tr>
              <td class="muted">${b.bill_no}</td>
              <td><b>${esc(b.table_name)}</b></td>
              <td>${fmtTime(b.opened_at)}</td>
              <td>${fmtTime(b.closed_at)}</td>
              <td>${b.billed_hours}h</td>
              <td>${money(b.table_fee)}</td>
              <td>${money(b.goods_fee)}</td>
              <td>${money(b.total_amount)}</td>
              <td>${money(b.discount)}</td>
              <td><b>${money(b.pay_amount)}</b></td>
              <td>${PAY_METHODS[b.pay_method] || b.pay_method}</td>
              <td><button class="btn sm" onclick="showBillModal(${b.id})">详情/打印</button></td>
            </tr>`).join('') || '<tr><td colspan="12" class="muted">该日期暂无账单</td></tr>'}
        </tbody>
      </table>`;
    refreshInProgress(); // 填充「进行中的桌台」实时区
  } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// 进行中的桌台：订单被接受后实时同步到账单查询页（轮询只刷新这一块，不重渲染整页）
async function refreshInProgress() {
  const box = $('#billsInProgress');
  if (!box) return; // 不在账单查询页签时不拉取
  try {
    const list = await api('/bills/in-progress');
    box.innerHTML = list.length
      ? `<h2 class="ip-title">进行中的桌台 <small class="muted">已接单的订单实时同步在此，每 8 秒自动刷新</small></h2>
         ${list.map(inProgressCard).join('')}`
      : '';
  } catch (_) { /* 网络抖动忽略，下个周期重试 */ }
}

// 单张进行中桌台卡片：累计桌费 + 每笔已接单订单的商品明细
function inProgressCard(s) {
  return `
  <div class="ocard ip-card">
    <div class="ocard-head">
      <b>桌台 ${esc(s.table_name)}</b>
      <span class="tag st-confirmed">进行中</span>
      <span class="muted">开台 ${fmtTime(s.opened_at)} · 已开 ${fmtDur(s.opened_at)}</span>
      <span class="oamount">${money(s.estimate_total)}</span>
    </div>
    <table class="kv">
      <tr><td>桌费（累计）</td><td>${Math.floor(s.minutes / 60)}小时${s.minutes % 60}分（计费 ${s.billed_hours}h × ${money(s.hourly_rate)}）= ${money(s.table_fee)}</td></tr>
      <tr><td>商品费（${s.orders.length} 笔已接单）</td><td>${money(s.goods_fee)}</td></tr>
      <tr class="total"><td>预计应收</td><td>${money(s.estimate_total)}</td></tr>
    </table>
    ${s.orders.length ? `<ul class="oitems">${s.orders.map((o) => `
      <li>
        <span class="tag st-confirmed">已接单</span> ${esc(o.order_no)} · ${fmtTime(o.confirmed_at)} <b>${money(o.total_amount)}</b>
        <div class="muted">${o.items.map((it) => `${esc(it.product_name)} × ${it.quantity}　${money(it.subtotal)}`).join('<br>')}</div>
        ${o.remark ? `<div class="muted">备注：${esc(o.remark)}</div>` : ''}
      </li>`).join('')}</ul>`
      : '<p class="muted">还没有已接单的订单</p>'}
  </div>`;
}

// 账单详情弹窗 + 打印小票
async function showBillModal(billId) {
  let b;
  try { b = await api('/bills/' + billId); } catch (e) { return alert(e.message); }
  openModal(`
    <h3>账单详情 · ${esc(b.table_name)}</h3>
    <table class="kv">
      <tr><td>账单号</td><td>${b.bill_no}</td></tr>
      <tr><td>顾客</td><td>${esc(b.customer_name || '-')}</td></tr>
      <tr><td>开台 / 结桌</td><td>${fmtTime(b.opened_at)} → ${fmtTime(b.closed_at)}（${Math.floor(b.duration_minutes/60)}小时${b.duration_minutes%60}分）</td></tr>
      <tr><td>桌费</td><td>${b.billed_hours}h × ${money(b.hourly_rate)} = ${money(b.table_fee)}</td></tr>
      <tr><td>商品费</td><td>${money(b.goods_fee)}</td></tr>
      <tr><td>优惠</td><td>-${money(b.discount)}</td></tr>
      <tr class="total"><td>实收</td><td>${money(b.pay_amount)}（${PAY_METHODS[b.pay_method] || b.pay_method}）</td></tr>
    </table>
    ${b.orders.length ? `<h4>商品明细</h4><ul class="oitems">${
      b.orders.flatMap(o => o.items).map(it =>
        `<li>${esc(it.product_name)} × ${it.quantity} <span class="muted">${money(it.subtotal)}</span></li>`).join('')
    }</ul>` : ''}
    <div class="modal-btns">
      <button class="btn" onclick="closeModal()">关闭</button>
      <button class="btn primary" onclick="printBill(${b.id})">🖨 打印小票</button>
    </div>`);
}

// 打印小票：把账单渲染进 #printArea，用浏览器打印（@media print 只显示该区域）
async function printBill(billId) {
  const b = await api('/bills/' + billId);
  const items = b.orders.flatMap(o => o.items);
  $('#printArea').innerHTML = `
    <h2>棋牌室消费小票</h2>
    <p>账单号：${b.bill_no}<br>桌台：${esc(b.table_name)}　顾客：${esc(b.customer_name || '-')}<br>
       开台：${fmtTime(b.opened_at)}　结桌：${fmtTime(b.closed_at)}</p>
    <hr>
    <p>桌费：${b.billed_hours} 小时 × ${money(b.hourly_rate)} = ${money(b.table_fee)}</p>
    ${items.length ? `<p>商品：</p><ul>${items.map(it =>
      `<li>${esc(it.product_name)} × ${it.quantity}　${money(it.subtotal)}</li>`).join('')}</ul>` : ''}
    <hr>
    <p>应收：${money(b.total_amount)}　优惠：-${money(b.discount)}<br>
       <b>实收：${money(b.pay_amount)}（${PAY_METHODS[b.pay_method] || b.pay_method}）</b></p>
    <p style="text-align:center">谢谢惠顾，欢迎再来！</p>`;
  window.print();
}

/* ================= 新订单提醒（轮询） ================= */

async function pollNewOrders() {
  if (!token) return;
  try {
    const data = await api('/notify/new-orders?since_id=' + lastOrderId);
    // 数据库被重置过（订单 id 倒退）：静默下调基线，否则提醒会永久失灵
    if (data.latest_id < lastOrderId) {
      lastOrderId = data.latest_id;
      localStorage.setItem('lastOrderId', lastOrderId);
      return;
    }
    // 首次轮询且没有存量基线：只记基线，不弹历史订单
    if (firstPoll) {
      firstPoll = false;
      if (!lastOrderId) {
        lastOrderId = data.latest_id;
        localStorage.setItem('lastOrderId', lastOrderId);
        return;
      }
      // 有旧基线（localStorage 恢复）：期间新到的订单照常提醒，不 return
    }
    if (data.orders.length > 0) {
      lastOrderId = data.latest_id;
      localStorage.setItem('lastOrderId', lastOrderId);
      setBadge(unseenCount + data.orders.length);
      beep();
      for (const o of data.orders) {
        toast(`🛎 <b>桌台 ${esc(o.table_name)}</b> 新订单 ${money(o.total_amount)}<br>
               <span class="muted">${o.items.map(it => `${esc(it.product_name)}×${it.quantity}`).join('、')}</span><br>
               <small>点击查看并处理</small>`,
              () => { orderFilter = 'pending'; switchTab('orders'); });
      }
    } else if (data.latest_id > lastOrderId) {
      lastOrderId = data.latest_id;
      localStorage.setItem('lastOrderId', lastOrderId);
    }
  } catch (_) { /* 网络抖动忽略，下个周期重试 */ }
}

/* ================= 启动 ================= */

// 定时器句柄：重复登录（token 过期后再登录）时先清掉旧的，避免轮询成倍叠加
let appTimers = [];

async function initApp() {
  appTimers.forEach(clearInterval);
  appTimers = [];
  $('#soundBtn').textContent = soundOn ? '🔊' : '🔇';
  renderTables();
  pollNewOrders();
  // 每 8 秒轮询新订单；桌台看板可见时顺带刷新（顾客自助开台能实时看到）
  appTimers.push(setInterval(() => {
    pollNewOrders();
    if (!$('#tab-tables').classList.contains('hidden')) renderTables();
    if (!$('#tab-bills').classList.contains('hidden')) refreshInProgress();
  }, 8000));
  // 顶栏时钟 + 使用中桌台时长每分钟刷新
  appTimers.push(setInterval(() => {
    $('#clock').textContent = new Date().toLocaleString('zh-CN');
    if (!$('#tab-tables').classList.contains('hidden')) renderTables();
  }, 60000));
}

// 页面加载：校验 token 是否有效
(async function boot() {
  if (token) {
    try {
      const res = await fetch('/api/check', { headers: { 'x-admin-token': token } });
      const data = await res.json();
      if (data.ok) return initApp();
    } catch (_) {}
    token = ''; localStorage.removeItem('adminToken');
  }
  showLogin();
})();
