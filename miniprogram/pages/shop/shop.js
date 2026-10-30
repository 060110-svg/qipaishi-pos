/**
 * 点单页：分类 + 商品 + 购物车 + 提交订单（对应网页端 mobile 的点单视图）
 */
const api = require('../../utils/api.js');
const app = getApp();

const CATEGORIES = { all: '全部', cigarette: '香烟', drink: '饮料', snack: '零食', other: '其他' };

Page({
  data: {
    tableName: '',
    cats: [], cat: 'all',
    products: [],
    cart: {},            // { 商品id: 数量 }
    cartCount: 0,
    cartTotalText: '¥0.00',
    showConfirm: false,
    confirmItems: [],
    confirmTotalText: '¥0.00',
    remark: '',
  },

  onShow() {
    this.boot();
    this._timer = setInterval(() => this.checkTable(), 15000);
  },
  onHide() { clearInterval(this._timer); },
  onUnload() { clearInterval(this._timer); },

  // 进入点单页必须有有效桌台；被结桌后自动退回选桌页
  async boot() {
    const ok = await this.checkTable();
    if (ok) this.loadProducts();
  },

  async checkTable() {
    const savedId = Number(wx.getStorageSync('currentTableId') || 0);
    try {
      const tables = await api.request('/tables');
      const t = tables.find((x) => x.id === savedId);
      if (t && t.status === 'occupied') {
        app.setTable(t);
        this.setData({ tableName: '桌台 ' + t.name });
        return true;
      }
    } catch (_) { return true; } // 网络抖动不打断顾客
    // 桌台不存在或已结桌
    if (savedId) api.toast('本桌已结账，感谢惠顾！');
    app.clearTable();
    wx.reLaunch({ url: '/pages/tables/tables' });
    return false;
  },

  async loadProducts() {
    try {
      const products = await api.request('/products'); // 后端只返回上架商品
      this._products = products;
      const usedCats = ['all', ...Object.keys(CATEGORIES)
        .filter((c) => c !== 'all' && products.some((p) => p.category === c))];
      this.setData({ cats: usedCats.map((c) => ({ key: c, text: CATEGORIES[c] || c })) });
      this.renderProducts();
    } catch (e) {
      api.toast(e.message);
    }
  },

  renderProducts() {
    const cart = this.data.cart;
    const list = this.data.cat === 'all'
      ? this._products
      : this._products.filter((p) => p.category === this.data.cat);
    this.setData({
      products: list.map((p) => ({
        ...p,
        priceText: api.money(p.price),
        qty: cart[p.id] || 0,
        soldOut: p.stock === 0,
      })),
    });
  },

  setCat(e) {
    this.setData({ cat: e.currentTarget.dataset.key });
    this.renderProducts();
  },

  changeQty(e) {
    const { pid, delta } = e.currentTarget.dataset;
    const p = this._products.find((x) => x.id === Number(pid));
    if (!p) return;
    const cart = { ...this.data.cart };
    const next = (cart[p.id] || 0) + Number(delta);
    if (p.stock >= 0 && next > p.stock) return api.toast(`「${p.name}」库存只剩 ${p.stock} 件`);
    if (next <= 0) delete cart[p.id];
    else cart[p.id] = next;
    this.setData({ cart });
    this.renderProducts();
    this.updateCartBar();
  },

  cartLines() {
    return Object.entries(this.data.cart).map(([id, qty]) => {
      const p = this._products.find((x) => x.id === Number(id));
      return p ? { p, qty, subtotal: p.price * qty } : null;
    }).filter(Boolean);
  },

  updateCartBar() {
    const lines = this.cartLines();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.subtotal, 0);
    this.setData({ cartCount: count, cartTotalText: api.money(total) });
  },

  openConfirm() {
    const lines = this.cartLines();
    if (!lines.length) return;
    this.setData({
      showConfirm: true,
      confirmItems: lines.map((l) => ({
        name: l.p.name, qty: l.qty, subtotalText: api.money(l.subtotal),
      })),
      confirmTotalText: api.money(lines.reduce((s, l) => s + l.subtotal, 0)),
    });
  },
  closeConfirm() { this.setData({ showConfirm: false }); },
  noop() {},
  onRemarkInput(e) { this.setData({ remark: e.detail.value }); },

  async doSubmit() {
    const table = app.globalData.table;
    if (!table) return;
    const lines = this.cartLines();
    if (!lines.length) return;
    this.setData({ submitting: true });
    try {
      await api.request('/orders', {
        method: 'POST',
        body: {
          table_id: table.id,
          items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty })),
          remark: this.data.remark.trim(),
        },
      });
      this.setData({ cart: {}, remark: '', showConfirm: false });
      this.updateCartBar();
      api.toast('下单成功！店长已收到提醒', 'success');
      this.loadProducts();
      wx.switchTab({ url: '/pages/orders/orders' });
    } catch (e) {
      api.toast(e.message);
    } finally {
      this.setData({ submitting: false });
    }
  },
});
