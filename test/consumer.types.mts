import automator from 'alipay-miniprogram-automator'

const launched: Promise<automator.MiniProgram> = automator.launch({
  projectPath: '/tmp/native-miniapp',
})
const connected: Promise<automator.MiniProgram> = automator.connect({ port: 19387 })
void launched
void connected
