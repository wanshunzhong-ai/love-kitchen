// 云服务客户端：全应用唯一初始化，各页面统一从这里引入
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

// 云服务分配给本应用的公开配置（可安全放进前端代码）
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_Q7J8UvVewXzjOG0IpQ4004_YvTgzvQz246XbF58PqpMDb7AO7mrwPjs',
}

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx),
})

module.exports = { cloud, publicConfig }
