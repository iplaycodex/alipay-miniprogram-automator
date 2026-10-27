Page({
  data: { count: '' },
  onLoad(query) { this.setData({ count: query.count || '0' }) },
  goBack() { my.navigateBack() }
})
