/**
 * 店长商品管理：查看全部商品（含下架）、上下架切换、调整库存/价格
 */
const api = require('../../utils/api.js');

const CATEGORY_TEXT = {
  cigarette: '香烟',
  drink: '饮料',
  snack: '零食',
  other: '其他',
};

Page({
  data: {
    products: [],
    loading: true,
  },

  onLoad() {
    if (!wx.getStorageSync('isAdmin')) {
      wx.redirectTo({ url: '/pages/admin/login' });
      return;
    }
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const products = await api.request('/products?all=1');
      this.setData({
        products: products.map((p) => ({
          ...p,
          categoryText: CATEGORY_TEXT[p.category] || p.category,
          priceText: Number(p.price).toFixed(2),
          stockText: p.stock < 0 ? '不限量' : String(p.stock),
          active: Boolean(p.is_active),
        })),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      if (/登录/.test(e.message)) {
        wx.removeStorageSync('adminToken');
        wx.removeStorageSync('isAdmin');
        wx.redirectTo({ url: '/pages/admin/login' });
      } else {
        api.toast(e.message);
      }
    }
  },

  // 上架/下架切换
  async toggleActive(e) {
    const { id, active } = e.currentTarget.dataset;
    try {
      await api.request(`/products/${id}`, {
        method: 'PUT',
        body: { is_active: active ? 0 : 1 },
      });
      api.toast(active ? '已下架' : '已上架', 'success');
      this.load();
    } catch (err) {
      api.toast(err.message);
    }
  },

  // 库存 +1 / -1 快捷调整
  async adjustStock(e) {
    const { id, delta } = e.currentTarget.dataset;
    const p = this.data.products.find((x) => x.id === id);
    if (!p || p.stock < 0) return; // 不限量商品无需调整
    const next = Math.max(0, p.stock + Number(delta));
    try {
      await api.request(`/products/${id}`, { method: 'PUT', body: { stock: next } });
      this.load();
    } catch (err) {
      api.toast(err.message);
    }
  },

  // 手动输入库存
  async editStock(e) {
    const { id, stock } = e.currentTarget.dataset;
    const res = await wx.showModal({
      title: '设置库存',
      editable: true,
      placeholderText: '输入数量，-1 表示不限量',
      content: String(stock),
    });
    if (!res.confirm) return;
    const n = Number.parseInt(res.content, 10);
    if (Number.isNaN(n) || n < -1) return api.toast('请输入 -1 或 ≥0 的整数');
    try {
      await api.request(`/products/${id}`, { method: 'PUT', body: { stock: n } });
      api.toast('库存已更新', 'success');
      this.load();
    } catch (err) {
      api.toast(err.message);
    }
  },

  // 修改价格
  async editPrice(e) {
    const { id, price } = e.currentTarget.dataset;
    const res = await wx.showModal({
      title: '修改价格',
      editable: true,
      placeholderText: '输入新价格（元）',
      content: String(price),
    });
    if (!res.confirm) return;
    const n = Number(res.content);
    if (!Number.isFinite(n) || n < 0) return api.toast('请输入有效价格');
    try {
      await api.request(`/products/${id}`, { method: 'PUT', body: { price: n } });
      api.toast('价格已更新', 'success');
      this.load();
    } catch (err) {
      api.toast(err.message);
    }
  },

  onPullDownRefresh() {
    this.load();
    wx.stopPullDownRefresh();
  },
});
