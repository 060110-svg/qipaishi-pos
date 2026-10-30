/**
 * 顾客移动端逻辑（原生 JS）
 * 流程：选桌(或扫二维码带 ?table=A1 直达) → 空闲桌自助开台 → 选购商品 → 提交订单 → 查看本桌订单
 * 订单提交后店长后台会收到提醒；店长确认的订单结桌时统一并入账单。
 */

/* ---------- 常量与状态 ---------- */
const CATEGORIES = { all: '全部', cigarette: '香烟', drink: '饮料', snack: '零食', other: '其他' };
const ORDER_STATUS = {
  pending:   { text: '待店长确认', cls: 'st-pending' },
  confirmed: { text: '已确认', cls: 'st-confirmed' },
  cancelled: { text: '已取消', cls: 'st-cancelled' },
  settled:   { text: '已结账', cls: 'st-settled' },
};

let tables = [];          // 所有桌台
let products = [];        // 上架商品
let currentTable = null;  // 当前选中桌台
let cart = {};            // 购物车 { 商品id: 数量 }
let catFilter = 'all';    // 当前分类筛选

const $ = (s) => document.querySelector(s);
const money = (n) => '¥' + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 通用请求（顾客端无需登录） ---------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
  return data;
}

function toast(msg, ms = 2500) {
  const el = $('#mToast');
  el.innerHTML = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ---------- 视图切换 ---------- */
function showView(name) {
  ['viewTables', 'viewShop', 'viewOrders'].forEach((v) => $('#' + v).classList.add('hidden'));
  $('#mNav').classList.toggle('hidden', name === 'tables');
  if (name === 'tables') { $('#viewTables').classList.remove('hidden'); renderTables(); }
  if (name === 'shop')   { $('#viewShop').classList.remove('hidden'); renderProducts(); }
  if (name === 'orders') { $('#viewOrders').classList.remove('hidden'); renderOrders(); }
}
document.querySelectorAll('.m-nav-item').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.m-nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    showView(btn.dataset.view);
  }));

/* ---------- 选桌 / 开台 ---------- */
async function loadTables() {
  tables = await api('/tables');
}

function renderTables() {
  $('#mTableGrid').innerHTML = tables.map((t) => {
    const occ = t.status === 'occupied';
    return `
    <div class="m-tcard ${occ ? 'occupied' : ''}" onclick="pickTable(${t.id})">
      <div class="m-tname">${esc(t.name)}</div>
      <div class="m-ttype">${money(t.hourly_rate)}/小时</div>
      <div class="m-tstatus ${occ ? 'occ' : ''}">${occ ? '使用中 · 点击点单' : '空闲 · 点击开台'}</div>
    </div>`;
  }).join('');
}

// 点击桌台：空闲 → 询问开台；使用中 → 直接进入点单
async function pickTable(id) {
  const t = tables.find((x) => x.id === id);
  if (!t) return;
  if (t.status === 'occupied') return enterTable(t);
  if (!confirm(`桌台「${t.name}」当前空闲。\n费率 ${money(t.hourly_rate)}/小时，最低消费 ${t.min_hours} 小时。\n\n确定现在开台吗？开台后即开始计费。`)) {
    showView('tables'); // 扫码进入又取消开台时，回落到选桌页，避免整页空白
    return;
  }
  try {
    const opened = await api(`/tables/${id}/open`, { method: 'POST', body: { customer_name: '自助开台' } });
    toast('✅ 开台成功，开始计费');
    enterTable(opened);
  } catch (e) {
    toast('❌ ' + esc(e.message));
    await loadTables();
    showView('tables');
  }
}

// 进入某桌的点单界面
function enterTable(t) {
  currentTable = t;
  sessionStorage.setItem('currentTableId', t.id);
  $('#mTableName').textContent = '桌台 ' + t.name;
  $('#mTableInfo').textContent = t.status === 'occupied' ? '使用中' : '';
  $('#mSwitchBtn').classList.remove('hidden');
  showView('shop');
  loadProducts();
}

// 换桌
$('#mSwitchBtn').addEventListener('click', () => {
  currentTable = null;
  sessionStorage.removeItem('currentTableId');
  cart = {}; updateCartBar();
  $('#mTableName').textContent = '选择桌台';
  $('#mSwitchBtn').classList.add('hidden');
  loadTables().then(() => showView('tables'));
});

/* ---------- 商品与购物车 ---------- */
async function loadProducts() {
  products = await api('/products'); // 顾客端只返回上架商品
  renderProducts();
}

function renderProducts() {
  // 分类页签（只显示有商品的分类 + 全部）
  const usedCats = ['all', ...Object.keys(CATEGORIES).filter((c) => c !== 'all' && products.some((p) => p.category === c))];
  $('#mCats').innerHTML = usedCats.map((c) =>
    `<button class="m-cat ${catFilter === c ? 'active' : ''}" onclick="setCat('${c}')">${CATEGORIES[c] || c}</button>`).join('');

  const list = catFilter === 'all' ? products : products.filter((p) => p.category === catFilter);
  $('#mProducts').innerHTML = list.map((p) => {
    const qty = cart[p.id] || 0;
    const soldOut = p.stock === 0;
    return `
    <div class="m-pcard">
      <div class="m-pinfo">
        <div class="m-pname">${esc(p.name)}</div>
        <div class="m-pprice">${money(p.price)} ${p.stock >= 0 ? `<span class="m-pstock">库存${p.stock}</span>` : ''}</div>
      </div>
      ${soldOut
        ? '<span class="m-soldout">已售罄</span>'
        : qty === 0
          ? `<button class="m-add" onclick="changeQty(${p.id}, 1)">＋</button>`
          : `<div class="m-stepper">
               <button onclick="changeQty(${p.id}, -1)">－</button>
               <span>${qty}</span>
               <button onclick="changeQty(${p.id}, 1)">＋</button>
             </div>`}
    </div>`;
  }).join('') || '<p class="m-empty">该分类暂无商品</p>';
}
function setCat(c) { catFilter = c; renderProducts(); }

function changeQty(productId, delta) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  const next = (cart[productId] || 0) + delta;
  if (p.stock >= 0 && next > p.stock) return toast(`「${esc(p.name)}」库存只剩 ${p.stock} 件`);
  if (next <= 0) delete cart[productId];
  else cart[productId] = next;
  renderProducts();
  updateCartBar();
}

function cartLines() {
  return Object.entries(cart).map(([id, qty]) => {
    const p = products.find((x) => x.id === Number(id));
    return p ? { p, qty, subtotal: p.price * qty } : null;
  }).filter(Boolean);
}
function updateCartBar() {
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  $('#mCartBar').classList.toggle('hidden', count === 0);
  $('#mCartCount').textContent = count;
  $('#mCartTotal').textContent = money(total);
}

/* ---------- 提交订单 ---------- */
$('#mSubmitBtn').addEventListener('click', () => {
  const lines = cartLines();
  if (!lines.length || !currentTable) return;
  $('#mConfirmItems').innerHTML = lines.map((l) =>
    `<li>${esc(l.p.name)} <span class="muted">× ${l.qty}</span><b>${money(l.subtotal)}</b></li>`).join('');
  $('#mConfirmTotal').textContent = money(lines.reduce((s, l) => s + l.subtotal, 0));
  $('#mConfirmMask').classList.remove('hidden');
});
$('#mCancelOrder').addEventListener('click', () => $('#mConfirmMask').classList.add('hidden'));

$('#mDoSubmit').addEventListener('click', async () => {
  const btn = $('#mDoSubmit');
  btn.disabled = true;
  try {
    const order = await api('/orders', {
      method: 'POST',
      body: {
        table_id: currentTable.id,
        items: Object.entries(cart).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity })),
        remark: $('#mRemark').value.trim(),
      },
    });
    cart = {}; $('#mRemark').value = '';
    updateCartBar();
    $('#mConfirmMask').classList.add('hidden');
    toast('✅ 下单成功！店长已收到提醒，请稍候');
    loadProducts();                       // 刷新库存显示
    document.querySelector('[data-view="orders"]').click(); // 跳到我的订单
  } catch (e) {
    toast('❌ ' + esc(e.message), 3500);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 我的订单（本桌） ---------- */
async function renderOrders() {
  if (!currentTable) { $('#mOrders').innerHTML = '<p class="m-empty">请先选择桌台</p>'; return; }
  try {
    const list = await api(`/orders?table_id=${currentTable.id}&limit=50`);
    $('#mOrders').innerHTML = list.length ? list.map((o) => {
      const st = ORDER_STATUS[o.status] || { text: o.status, cls: '' };
      return `
      <div class="m-ocard">
        <div class="m-ohead">
          <span class="tag ${st.cls}">${st.text}</span>
          <span class="muted">${new Date(o.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' })}</span>
          <b class="m-oamount">${money(o.total_amount)}</b>
        </div>
        <div class="m-oitems">${o.items.map((it) => `${esc(it.product_name)}×${it.quantity}`).join('　')}</div>
        ${o.remark ? `<div class="muted">备注：${esc(o.remark)}</div>` : ''}
      </div>`;
    }).join('') : '<p class="m-empty">本桌还没有订单，去点些饮料零食吧～</p>';
  } catch (e) { $('#mOrders').innerHTML = `<p class="m-empty">${esc(e.message)}</p>`; }
}

/* ---------- 启动：支持二维码 ?table=A1 直达 ---------- */
(async function boot() {
  try {
    await loadTables();

    // 1) 网址带桌台名（每张桌贴一个二维码：/mobile/?table=A1）
    const name = new URLSearchParams(location.search).get('table');
    if (name) {
      const t = tables.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (t) return t.status === 'occupied' ? enterTable(t) : pickTable(t.id);
      toast(`未找到桌台「${esc(name)}」，请手动选择`);
    }

    // 2) 恢复上次选择的桌台（刷新页面不丢）
    const savedId = Number(sessionStorage.getItem('currentTableId') || 0);
    const saved = tables.find((x) => x.id === savedId);
    if (saved && saved.status === 'occupied') return enterTable(saved);

    // 3) 默认进入选桌页
    showView('tables');
  } catch (e) {
    toast('❌ 加载失败：' + esc(e.message), 4000);
  }
})();

// 每 15 秒静默刷新：桌台被店长结桌后自动退回选桌页；订单状态实时更新
setInterval(async () => {
  try {
    await loadTables();
    if (currentTable) {
      const t = tables.find((x) => x.id === currentTable.id);
      if (!t || t.status !== 'occupied') {
        currentTable = null;
        sessionStorage.removeItem('currentTableId');
        cart = {}; updateCartBar();
        toast('本桌已结账，感谢惠顾！');
        $('#mTableName').textContent = '选择桌台';
        $('#mSwitchBtn').classList.add('hidden');
        showView('tables');
        return;
      }
      if (!$('#viewOrders').classList.contains('hidden')) renderOrders();
    } else if (!$('#viewTables').classList.contains('hidden')) {
      renderTables();
    }
  } catch (_) { /* 忽略网络抖动 */ }
}, 15000);
