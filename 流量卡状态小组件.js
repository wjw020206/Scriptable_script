// 创建小组件
const widget = new ListWidget();

// 用户配置
const CookieValue = ''; // 替换为你实际 Cookie
const NOTIFICATION_KEY = 'traffic_card_last_notify_date'; // Keychain 存储键名

// 检查今天是否已经通知过
function hasNotifiedToday() {
  if (Keychain.contains(NOTIFICATION_KEY)) {
    const lastDate = Keychain.get(NOTIFICATION_KEY);
    const today = new Date().toDateString();
    return lastDate === today;
  }
  return false;
}

// 记录今天已通知
function markNotifiedToday() {
  const today = new Date().toDateString();
  Keychain.set(NOTIFICATION_KEY, today);
}

// 获取流量信息
const url = 'https://xjxjxj.iot889.com/app/client/card/get';
const request = new Request(url);
request.headers = {
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Content-Type': 'application/json;charset=UTF-8',
  Cookie: `APPLICATION_SESSION_NAME=${CookieValue}`,
  Referer: 'https://xjxjxj.iot889.com/wap/pages/home/home',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
};

// 小组件样式
widget.backgroundColor = new Color('#1c1c1e');

// 标题
const titleText = widget.addText('流量使用情况');
titleText.font = Font.boldSystemFont(16);
titleText.textColor = Color.white();
widget.addSpacer(8); // 添加间隔符

// 进度条函数
function createProgressBar(used, free, width = 150, height = 8) {
  const total = used + free;
  const usagePercentage = used / total;
  const radius = height / 2; // 圆角半径为高度的一半，实现胶囊形状

  // 创建进度条容器
  const barStack = widget.addStack();
  // 设置进度条容器的子元素从左到右水平排列
  barStack.layoutHorizontally();
  barStack.cornerRadius = radius;

  // 已使用（橙色）
  const usedPart = barStack.addStack(); // 在进度条容器中创建子容器
  usedPart.size = new Size(width * usagePercentage, height);
  usedPart.backgroundColor = Color.orange();

  // 剩余（绿色）
  const freePart = barStack.addStack();
  freePart.size = new Size(width * (1 - usagePercentage), height);
  freePart.backgroundColor = Color.green();

  return barStack;
}

// 四舍五入函数（保留 digits 位小数）
function roundDecimal(num, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

// 刷新流量接口
async function refreshCardData() {
  const refreshUrl = 'https://xjxjxj.iot889.com/app/client/card/refresh';
  const refreshRequest = new Request(refreshUrl);

  refreshRequest.headers = {
    authority: 'xjxjxj.iot889.com',
    accept: '*/*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'zh-CN,zh;q=0.9',
    'content-type': 'application/json;charset=UTF-8',
    cookie: `APPLICATION_SESSION_NAME=${CookieValue}`,
    priority: 'u=1, i',
    referer: 'https://xjxjxj.iot889.com/wap/pages/home/home',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  };

  try {
    const refreshResponse = await refreshRequest.loadJSON();
    console.log('刷新请求完成');
    return refreshResponse;
  } catch (error) {
    console.log('刷新请求失败：' + error);
    return null;
  }
}

// 主逻辑
async function main() {
  // 先刷新
  await refreshCardData();

  try {
    const response = await request.loadJSON();

    if (!response) throw new Error('无返回数据');

    const data = response.data;

    // 卡号
    const cardText = widget.addText(`卡号: ${data.card}`);
    cardText.font = Font.regularSystemFont(12);
    cardText.textColor = Color.lightGray();
    widget.addSpacer(6);

    // 流量计算（MB → GB，截断两位小数）
    const usedGB = roundDecimal(data.used / 1024, 2);
    const freeGB = roundDecimal(data.free / 1024, 2);
    const totalGB = roundDecimal((data.used + data.free) / 1024, 2);
    const usagePercentage = roundDecimal(
      (data.used / (data.used + data.free)) * 100,
      2
    );

    // 概览
    const statsText = widget.addText(
      `${usedGB} / ${totalGB} GB (${usagePercentage}%)`
    );
    statsText.font = Font.boldSystemFont(9);
    statsText.textColor = Color.white();
    widget.addSpacer(4);

    // 进度条
    createProgressBar(data.used, data.free);
    widget.addSpacer(6);

    // 详细信息
    const usedText = widget.addText(`已使用: ${usedGB} GB`);
    usedText.font = Font.regularSystemFont(12);
    usedText.textColor = Color.orange();

    const freeText = widget.addText(`未使用: ${freeGB} GB`);
    freeText.font = Font.regularSystemFont(12);
    freeText.textColor = Color.green();

    // 过期天数计算
    const expirationDate = new Date(data.expirationTime.replace(' ', 'T'));
    const currentTime = new Date();
    const diffTime = expirationDate - currentTime;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // 剩余 3 天或更少时发送通知（每天只通知一次）
    if (diffDays <= 3 && !hasNotifiedToday()) {
      const notification = new Notification();
      notification.title = '流量卡即将到期';
      notification.body = '请充值';
      notification.sound = 'default';
      await notification.schedule();
      markNotifiedToday();
    }

    const expireLabel =
      diffDays <= 3
        ? `剩余: ${diffDays} 天(请充值)`
        : `剩余: ${diffDays} 天`;
    const expireText = widget.addText(expireLabel);
    expireText.font = Font.regularSystemFont(12);
    expireText.textColor = diffDays <= 3 ? Color.red() : Color.cyan();

    widget.addSpacer(6);

    // 更新时间
    const now = new Date();
    const timeText = widget.addText(
      `更新: ${now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    );
    timeText.font = Font.regularSystemFont(10);
    timeText.textColor = Color.gray();
  } catch (error) {
    const errorText = widget.addText('请求出错');
    errorText.font = Font.regularSystemFont(14);
    errorText.textColor = Color.red();

    const detailText = widget.addText('请检查网络和 Cookie');
    detailText.font = Font.regularSystemFont(10);
    detailText.textColor = Color.red();
  }

  // 输出小组件
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    widget.presentSmall();
  }
}

// 执行
await main();
Script.complete();
