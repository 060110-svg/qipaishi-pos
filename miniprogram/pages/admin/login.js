/**
 * 店长登录页面
 * 后端 POST /api/login { password } → 成功 { token }；失败 401 { error }
 */
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    password: '',
    loading: false,
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  async onSubmit() {
    const pwd = this.data.password.trim();
    if (!pwd) return api.toast('请输入密码');
    if (this.data.loading) return;

    this.setData({ loading: true });
    try {
      const r = await api.request('/login', { method: 'POST', body: { password: pwd } });
      if (r && r.token) {
        wx.setStorageSync('adminToken', r.token);
        wx.setStorageSync('isAdmin', true);
        app.setAdminMode(true);
        api.toast('登录成功', 'success');
        // 验证令牌有效性后跳转到店长管理页
        wx.redirectTo({ url: '/pages/admin/manager' });
      } else {
        api.toast('登录失败：未返回令牌');
      }
    } catch (e) {
      // 401（密码错误/锁定）、429（尝试过多）等错误信息都在这里
      api.toast(e.message || '登录失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  backToCustomer() {
    wx.reLaunch({ url: '/pages/tables/tables' });
  },
});
