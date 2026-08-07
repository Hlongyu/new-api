import { createApplication } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const application = createApplication(config)

application.server.listen(config.port, '0.0.0.0', () => {
  application.start()
  const protocol = config.tlsCertPath ? 'https' : 'http'
  console.log(`New API 排行榜已启动：${protocol}://localhost:${config.port}`)
})

function shutdown() {
  application.server.close(() => {
    application.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
