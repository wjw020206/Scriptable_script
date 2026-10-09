// 基础 Url
const baseUrl = 'http://xj.mywuliankj.cn'
// 用户配置
const card = '' // 流量卡号，登录时使用
const NOTIFICATION_KEY = 'traffic_card_last_notify_date' // Keychain 存储键名

// Scriptable 兼容：获取 hostname
function getHostname(url) {
  return url
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
}

const host = getHostname(baseUrl)

// 创建小组件
const widget = new ListWidget()

// 检查今天是否已经通知过
function hasNotifiedToday() {
  if (Keychain.contains(NOTIFICATION_KEY)) {
    const lastDate = Keychain.get(NOTIFICATION_KEY)
    const today = new Date().toDateString()
    return lastDate === today
  }
  return false
}

// 记录今天已通知
function markNotifiedToday() {
  const today = new Date().toDateString()
  Keychain.set(NOTIFICATION_KEY, today)
}

// 按域名和卡号保存，切换配置时不会复用其他卡的登录状态。
const COOKIE_KEY = `traffic_card_cookies_${host}_${card}`
const SESSION_COOKIE = 'APPLICATION_SESSION_NAME'
let cookies = loadCookies()
let hasRetriedLogin = false

function loadCookies() {
  if (!Keychain.contains(COOKIE_KEY)) return {}
  try {
    const saved = JSON.parse(Keychain.get(COOKIE_KEY))
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  } catch (error) {
    return {}
  }
}

function saveCookies() {
  Keychain.set(COOKIE_KEY, JSON.stringify(cookies))
}

function cookieHeader() {
  // 没有 Expires 的会话 Cookie 也会持久保存；是否失效仍由服务器判断。
  const now = Date.now()
  const values = []
  for (const name of Object.keys(cookies)) {
    const item = cookies[name]
    if (!item || !item.value || (item.expiresAt && item.expiresAt <= now)) {
      delete cookies[name]
      continue
    }
    values.push(`${name}=${item.value}`)
  }
  saveCookies()
  return values.join('; ')
}

function updateCookies(response) {
  if (!response) return
  // Scriptable 会解析 Set-Cookie，包含 HttpOnly Cookie。
  for (const item of response.cookies || []) {
    const domain = (item.domain || host).replace(/^\./, '')
    if (host !== domain && !host.endsWith(`.${domain}`)) continue
    if (item.name) {
      const previous = cookies[item.name]
      cookies[item.name] = previous && previous.value === item.value
        ? previous : { value: item.value }
    }
  }

  // 同时读取原始响应头中的有效期，兼容多个 Set-Cookie 合并成一行。
  for (const name of Object.keys(response.headers || {})) {
    if (name.toLowerCase() !== 'set-cookie') continue
    const value = response.headers[name]
    const lines = Array.isArray(value) ? value : [String(value)]
    for (const line of lines) {
      // Expires 日期中的逗号后面不是 name=，因此不会被误拆分。
      for (const entry of line.split(/,(?=\s*[^\s;,=]+\s*=)/)) {
        const parts = entry.split(';').map(part => part.trim())
        const separator = parts[0].indexOf('=')
        if (separator < 1) continue
        const cookieName = parts[0].slice(0, separator)
        const item = { value: parts[0].slice(separator + 1) }
        let maxAge = null
        let domain = host
        for (const attribute of parts.slice(1)) {
          const index = attribute.indexOf('=')
          const key = (index < 0 ? attribute : attribute.slice(0, index)).toLowerCase()
          const val = index < 0 ? '' : attribute.slice(index + 1)
          if (key === 'expires') {
            const time = Date.parse(val)
            if (!isNaN(time)) item.expiresAt = time
          } else if (key === 'max-age' && /^-?\d+$/.test(val)) {
            maxAge = Number(val)
          } else if (key === 'domain') {
            domain = val.replace(/^\./, '')
          }
        }
        if (host !== domain && !host.endsWith(`.${domain}`)) continue
        // Max-Age 优先于 Expires。
        if (maxAge !== null) item.expiresAt = Date.now() + maxAge * 1000
        if (!item.value || (item.expiresAt && item.expiresAt <= Date.now())) {
          delete cookies[cookieName]
        } else {
          cookies[cookieName] = item
        }
      }
    }
  }
  saveCookies()
}

async function sendRequest(path, method = 'GET', body = null) {
  const request = new Request(`${baseUrl}${path}`)
  request.method = method
  request.timeoutInterval = 20
  request.headers = {
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    Origin: baseUrl,
    Referer: `${baseUrl}/wap/`,
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Content-Type': method === 'POST'
      ? 'application/x-www-form-urlencoded; charset=UTF-8'
      : 'application/json;charset=UTF-8',
  }
  const cookie = cookieHeader()
  if (cookie) request.headers.Cookie = cookie
  if (body !== null) request.body = body

  let text
  try {
    text = await request.loadString()
  } catch (error) {
    updateCookies(request.response)
    const status = request.response && request.response.statusCode
    if (status >= 400) {
      return { status, json: null, text: '', url: request.response.url || '' }
    }
    throw new Error('网络请求失败，请稍后重试')
  }
  updateCookies(request.response)
  let json = null
  try {
    json = JSON.parse(text)
  } catch (error) {
    // 登录页可能是 HTML，由下面的会话检测处理。
  }
  return {
    status: request.response.statusCode,
    url: request.response.url || '',
    json,
    text,
  }
}

function isSessionExpired(result) {
  if (result.status === 401 || result.status === 403) return true
  if (result.status >= 500) return false
  if (result.json) {
    // 网站前端对业务 code 14 的处理是跳转登录页。
    if (Number(result.json.code) === 14) return true
    return /未登录|未登陆|请.*登[录陆]|登[录陆].*(过期|失效)|会话.*(过期|失效)|session.*(expired|invalid)/i
      .test(result.json.msg || '')
  }
  return /\/app\/card\/login|\/wap\/pages\/index\/index/.test(result.url) ||
    /<html/i.test(result.text) && /登录|登錄|login/i.test(result.text)
}

function requireSuccess(result, message) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${message}（HTTP ${result.status}）`)
  }
  if (!result.json) throw new Error(`${message}：接口未返回 JSON`)
  if (Number(result.json.code) !== 0 || result.json.status === false) {
    throw new Error(`${message}（code ${result.json.code}）`)
  }
  return result.json
}

async function login() {
  if (!card.trim()) throw new Error('请先配置流量卡号 card')
  delete cookies[SESSION_COOKIE]
  saveCookies()
  try {
    // 先访问入口建立新会话，也收集 acw_tc、cdn_sec_tc 等 Cookie。
    const entry = await sendRequest('/wap/')
    if (entry.status < 200 || entry.status >= 300) {
      throw new Error(`登录入口访问失败（HTTP ${entry.status}）`)
    }
    // 入口可能只下发 CDN Cookie；匿名调用卡信息接口会创建应用会话。
    // 这里预期可能收到 HTTP 400 / code 14，仍需保留它下发的 Cookie。
    if (!cookies[SESSION_COOKIE]) {
      await sendRequest('/app/client/card/get')
    }
    const result = await sendRequest('/app/card/login', 'POST', `card=${encodeURIComponent(card)}`)
    const response = requireSuccess(result, '登录失败')
    if (!response.data || String(response.data.card) !== card) {
      throw new Error('登录返回的卡号不匹配')
    }
    cookieHeader()
    if (!cookies[SESSION_COOKIE]) {
      throw new Error('登录成功但未收到会话 Cookie')
    }
  } catch (error) {
    // 登录失败时不保留入口创建的未认证会话。
    delete cookies[SESSION_COOKIE]
    saveCookies()
    throw error
  }
  console.log('登录成功，Cookie 已保存')
}

async function requestWithSession(path) {
  let result = await sendRequest(path)
  if (isSessionExpired(result)) {
    // 每次运行最多自动重新登录一次，避免失败后无限重试。
    if (hasRetriedLogin) throw new Error('登录状态失效，请稍后重试')
    hasRetriedLogin = true
    await login()
    result = await sendRequest(path)
    if (isSessionExpired(result)) throw new Error('重新登录后会话仍然失效')
  }
  return requireSuccess(result, '接口请求失败')
}

// 小组件样式
widget.backgroundColor = new Color('#1c1c1e')

// 标题
const titleText = widget.addText('流量使用情况')
titleText.font = Font.boldSystemFont(16)
titleText.textColor = Color.white()
widget.addSpacer(8) // 添加间隔符

// 进度条函数
function createProgressBar(used, free, width = 150, height = 8) {
  const total = used + free
  const usagePercentage = used / total
  const radius = height / 2 // 圆角半径为高度的一半，实现胶囊形状

  // 创建进度条容器
  const barStack = widget.addStack()
  // 设置进度条容器的子元素从左到右水平排列
  barStack.layoutHorizontally()
  barStack.cornerRadius = radius

  // 已使用（橙色）
  const usedPart = barStack.addStack() // 在进度条容器中创建子容器
  usedPart.size = new Size(width * usagePercentage, height)
  usedPart.backgroundColor = Color.orange()

  // 剩余（绿色）
  const freePart = barStack.addStack()
  freePart.size = new Size(width * (1 - usagePercentage), height)
  freePart.backgroundColor = Color.green()

  return barStack
}

// 四舍五入函数（保留 digits 位小数）
function roundDecimal(num, digits) {
  const factor = Math.pow(10, digits)
  return Math.round(num * factor) / factor
}

// 刷新流量接口
async function refreshCardData() {
  try {
    const refreshResponse = await requestWithSession('/app/client/card/refresh')
    console.log('刷新请求完成')
    return refreshResponse
  } catch (error) {
    console.log('刷新请求失败：' + error)
    return null
  }
}

// 主逻辑
async function main() {
  try {
    cookieHeader()
    if (!cookies[SESSION_COOKIE]) await login()
    // 刷新失败仍尝试读取已有流量数据。
    await refreshCardData()
    const response = await requestWithSession('/app/client/card/get')

    if (!response) throw new Error('无返回数据')

    const data = response.data
    if (!data || String(data.card) !== card ||
        data.used == null || data.free == null ||
        !Number.isFinite(Number(data.used)) || !Number.isFinite(Number(data.free)) ||
        typeof data.expirationTime !== 'string') {
      throw new Error('流量接口返回的数据不完整')
    }
    data.used = Number(data.used)
    data.free = Number(data.free)

    // 卡号
    const cardText = widget.addText(`卡号: ${data.card}`)
    cardText.font = Font.regularSystemFont(12)
    cardText.textColor = Color.lightGray()
    widget.addSpacer(6)

    // 流量计算（MB → GB，截断两位小数）
    const usedGB = roundDecimal(data.used / 1024, 2)
    const freeGB = roundDecimal(data.free / 1024, 2)
    const totalGB = roundDecimal((data.used + data.free) / 1024, 2)
    const usagePercentage = roundDecimal(
      (data.used / (data.used + data.free)) * 100,
      2,
    )

    // 概览
    const statsText = widget.addText(
      `${usedGB} / ${totalGB} GB (${usagePercentage}%)`,
    )
    statsText.font = Font.boldSystemFont(9)
    statsText.textColor = Color.white()
    widget.addSpacer(4)

    // 进度条
    createProgressBar(data.used, data.free)
    widget.addSpacer(6)

    // 详细信息
    const usedText = widget.addText(`已使用: ${usedGB} GB`)
    usedText.font = Font.regularSystemFont(12)
    usedText.textColor = Color.orange()

    const freeText = widget.addText(`未使用: ${freeGB} GB`)
    freeText.font = Font.regularSystemFont(12)
    freeText.textColor = Color.green()

    // 过期天数计算
    const expirationDate = new Date(data.expirationTime.replace(' ', 'T'))
    const currentTime = new Date()
    const diffTime = expirationDate - currentTime
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    // 剩余 3 天或更少时发送通知（每天只通知一次）
    if (diffDays <= 3 && !hasNotifiedToday()) {
      const notification = new Notification()
      notification.title = '流量卡即将到期'
      notification.body = '请充值'
      notification.sound = 'default'
      await notification.schedule()
      markNotifiedToday()
    }

    const expireLabel =
      diffDays <= 3 ? `剩余: ${diffDays} 天(请充值)` : `剩余: ${diffDays} 天`
    const expireText = widget.addText(expireLabel)
    expireText.font = Font.regularSystemFont(12)
    expireText.textColor = diffDays <= 3 ? Color.red() : Color.cyan()

    widget.addSpacer(6)

    // 更新时间
    const now = new Date()
    const timeText = widget.addText(
      `更新: ${now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    )
    timeText.font = Font.regularSystemFont(10)
    timeText.textColor = Color.gray()
  } catch (error) {
    const errorText = widget.addText('请求出错')
    errorText.font = Font.regularSystemFont(14)
    errorText.textColor = Color.red()

    console.log('获取流量失败：' + error.message)
    const detailText = widget.addText(error.message || '请检查网络和卡号配置')
    detailText.font = Font.regularSystemFont(10)
    detailText.textColor = Color.red()
  }

  // 输出小组件
  if (config.runsInWidget) {
    Script.setWidget(widget)
  } else {
    widget.presentSmall()
  }
}

// 执行
await main()
Script.complete()
