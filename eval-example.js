// 远程 JS 地址，替换成你的 OSS 文件地址
const remoteJSUrl = ''

// 下载远程 JS
const req = new Request(remoteJSUrl)
req.headers = {
  'Cache-Control': 'no-cache',
}

const code = await req.loadString()

// 执行远程 JS
await eval(`(async () => {
${code}
})()`)
