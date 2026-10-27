Page({
  data: { count: '' },
  onLoad(query) {
    this.setData({ count: query.count || '0' })
  },
  openNext() {
    my.navigateTo({ url: '/pages/detail/index?count=43&word=%E4%B8%AD%E6%96%87' })
  },
  goBack() {
    my.navigateBack()
  },
})
