/**
 * Telegram Bot — 用户交互层
 *
 * 命令列表:
 * /start          — 注册 & 欢迎
 * /add             — 添加监控航线（交互式）
 * /list            — 查看所有监控
 * /del <id>        — 删除监控
 * /check <id>      — 立即查价
 * /history <id>    — 价格历史
 * /airports        — 查看支持的机场
 * /help            — 帮助
 */

import type { Env, TelegramUpdate, TelegramMessage, Route, PriceRecord } from '../types';
import { DEPARTURE_AIRPORTS, POPULAR_DESTINATIONS, searchAirport, getAirportName, formatPrice, formatDuration } from '../utils/airports';
import { checkAllRoutes } from '../monitor/checker';

const TG_API = 'https://api.telegram.org/bot';

// ============ Telegram API 工具函数 ============

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  parseMode?: string
): Promise<void> {
  await fetch(`${TG_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode || undefined,
      disable_web_page_preview: true,
    }),
  });
}

// ============ Webhook 处理 ============

export async function handleWebhook(
  update: TelegramUpdate,
  env: Env
): Promise<Response> {
  const message = update.message;
  if (!message?.text || !message.from) {
    return new Response('ok');
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const username = message.from.username || '';
  const name = `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim();

  // 确保用户存在
  await ensureUser(env, chatId, username, name);

  // 路由命令
  try {
    if (text === '/start') {
      await handleStart(env, chatId, name);
    } else if (text === '/help') {
      await handleHelp(env, chatId);
    } else if (text === '/list') {
      await handleList(env, chatId);
    } else if (text === '/airports') {
      await handleAirports(env, chatId);
    } else if (text.startsWith('/add')) {
      await handleAdd(env, chatId, text);
    } else if (text.startsWith('/del')) {
      await handleDelete(env, chatId, text);
    } else if (text.startsWith('/check')) {
      await handleCheck(env, chatId, text);
    } else if (text.startsWith('/history')) {
      await handleHistory(env, chatId, text);
    } else {
      // 智能解析自然语言（简单版）
      await handleNaturalInput(env, chatId, text);
    }
  } catch (err) {
    console.error('Bot handler error:', err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 出错了: ${err}`);
  }

  return new Response('ok');
}

// ============ 命令处理 ============

async function handleStart(env: Env, chatId: string, name: string) {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `👋 你好${name ? ' ' + name : ''}！我是机票监控机器人 ✈️\n\n` +
    `我会帮你盯着机票价格，便宜了立刻通知你。\n\n` +
    `*快速开始:*\n` +
    `输入类似这样的文字就行：\n` +
    `\`宁波飞三亚 10月 500以内\`\n` +
    `\`杭州飞曼谷 11月1日-15日 2000\`\n\n` +
    `或者用命令：\n` +
    `/add NGB SYX 2026-10-01 2026-10-31 500\n` +
    `/list — 查看所有监控\n` +
    `/airports — 支持的机场\n` +
    `/help — 完整帮助`,
    'Markdown'
  );
}

async function handleHelp(env: Env, chatId: string) {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✈️ *机票监控 Bot 使用帮助*\n\n` +
    `*添加监控:*\n` +
    `/add <出发> <目的地> <开始日期> <结束日期> <最高价>\n` +
    `例: /add NGB SYX 2026-10-01 2026-10-31 500\n\n` +
    `或者直接说人话：\n` +
    `\`宁波飞三亚 10月 500以内\`\n` +
    `\`上海飞曼谷 国庆后 2000\`\n\n` +
    `*管理监控:*\n` +
    `/list — 查看所有监控\n` +
    `/del <编号> — 删除监控\n` +
    `/check <编号> — 立即查价\n` +
    `/history <编号> — 价格走势\n\n` +
    `*其他:*\n` +
    `/airports — 支持的机场列表\n\n` +
    `*出发机场:* 宁波(NGB) 杭州(HGH) 上海浦东(PVG) 上海虹桥(SHA)\n\n` +
    `⏰ 系统每 6 小时自动查价，低于阈值立刻推送`,
    'Markdown'
  );
}

async function handleAdd(env: Env, chatId: string, text: string) {
  // /add NGB SYX 2026-10-01 2026-10-31 500
  const parts = text.split(/\s+/).slice(1);
  if (parts.length < 5) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `📝 格式: /add <出发> <目的地> <开始日期> <结束日期> <最高价>\n` +
      `例: /add NGB SYX 2026-10-01 2026-10-31 500\n\n` +
      `💡 或者直接说：\`宁波飞三亚 10月 500以内\``,
      'Markdown'
    );
    return;
  }

  const [origin, destination, dateFrom, dateTo, maxPriceStr] = parts;
  const maxPrice = parseInt(maxPriceStr);

  if (isNaN(maxPrice) || maxPrice <= 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ 价格必须是正整数');
    return;
  }

  // 验证机场代码
  const originUpper = origin.toUpperCase();
  const destUpper = destination.toUpperCase();

  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE telegram_chat_id = ?'
  ).bind(chatId).first<{ id: number }>();

  if (!user) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ 用户未注册，请先 /start');
    return;
  }

  await env.DB.prepare(
    `INSERT INTO routes (user_id, origin, destination, date_from, date_to, max_price)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(user.id, originUpper, destUpper, dateFrom, dateTo, maxPrice).run();

  const originName = getAirportName(originUpper);
  const destName = getAirportName(destUpper);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ 监控已添加！\n\n` +
    `✈️ ${originName} → ${destName}\n` +
    `📅 ${dateFrom} ~ ${dateTo}\n` +
    `💰 低于 ${formatPrice(maxPrice)} 时通知你\n\n` +
    `⏰ 每 6 小时自动查价，也可以 /check 立即查`
  );
}

async function handleList(env: Env, chatId: string) {
  const user = await getUser(env, chatId);
  if (!user) return;

  const { results: routes } = await env.DB.prepare(
    'SELECT * FROM routes WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC'
  ).bind(user.id).all<Route>();

  if (!routes || routes.length === 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '📭 你还没有监控航线\n\n用 /add 添加，或者直接说：\n`宁波飞三亚 10月 500以内`',
      'Markdown'
    );
    return;
  }

  let msg = `📋 *你的监控航线 (${routes.length}条)*\n\n`;
  for (const r of routes) {
    const origin = getAirportName(r.origin);
    const dest = r.destination ? getAirportName(r.destination) : '任意';
    msg += `*#${r.id}* ${origin} → ${dest}\n`;
    msg += `📅 ${r.date_from} ~ ${r.date_to}\n`;
    msg += `💰 阈值: ${formatPrice(r.max_price)}`;
    if (r.last_checked_at) {
      msg += ` | 上次查: ${r.last_checked_at.slice(5, 16)}`;
    }
    msg += `\n\n`;
  }
  msg += `操作: /check <编号> 立即查 | /del <编号> 删除`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'Markdown');
}

async function handleDelete(env: Env, chatId: string, text: string) {
  const parts = text.split(/\s+/);
  const routeId = parseInt(parts[1]);

  if (isNaN(routeId)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ 格式: /del <监控编号>');
    return;
  }

  const user = await getUser(env, chatId);
  if (!user) return;

  const result = await env.DB.prepare(
    'UPDATE routes SET is_active = 0 WHERE id = ? AND user_id = ?'
  ).bind(routeId, user.id).run();

  if (result.meta.changes > 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ 监控 #${routeId} 已删除`);
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 未找到监控 #${routeId}`);
  }
}

async function handleCheck(env: Env, chatId: string, text: string) {
  const parts = text.split(/\s+/);
  const routeId = parts[1] ? parseInt(parts[1]) : undefined;

  if (routeId === undefined || isNaN(routeId)) {
    // 如果没指定 ID，检查所有
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '🔍 正在查询所有航线...');
    await checkAllRoutes(env);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '✅ 查询完成');
    return;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🔍 正在查询航线 #${routeId}...`);
  // 这里简化处理，后续可以单独查某一条
  await checkAllRoutes(env);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '✅ 查询完成');
}

async function handleHistory(env: Env, chatId: string, text: string) {
  const parts = text.split(/\s+/);
  const routeId = parseInt(parts[1]);

  if (isNaN(routeId)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ 格式: /history <监控编号>');
    return;
  }

  const user = await getUser(env, chatId);
  if (!user) return;

  // 验证航线属于该用户
  const route = await env.DB.prepare(
    'SELECT * FROM routes WHERE id = ? AND user_id = ?'
  ).bind(routeId, user.id).first<Route>();

  if (!route) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 未找到监控 #${routeId}`);
    return;
  }

  // 获取最近价格记录
  const { results: records } = await env.DB.prepare(
    `SELECT * FROM price_records
     WHERE route_id = ?
     ORDER BY checked_at DESC
     LIMIT 30`
  ).bind(routeId).all<PriceRecord>();

  if (!records || records.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `📭 航线 #${routeId} 暂无价格记录\n用 /check ${routeId} 立即查价`);
    return;
  }

  const origin = getAirportName(route.origin);
  const dest = getAirportName(route.destination!);

  let msg = `📊 *价格走势 #${routeId}*\n`;
  msg += `✈️ ${origin} → ${dest}\n\n`;

  // 统计
  const prices = records.map(r => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  msg += `最低: ${formatPrice(min)} | 最高: ${formatPrice(max)} | 均价: ${formatPrice(avg)}\n`;
  msg += `阈值: ${formatPrice(route.max_price)}\n\n`;

  // 最近记录
  msg += `*最近记录:*\n`;
  const shown = new Set<string>();
  for (const r of records.slice(0, 10)) {
    const time = r.checked_at.slice(5, 16);
    const key = `${time}-${r.airline}`;
    if (shown.has(key)) continue;
    shown.add(key);
    msg += `${time} | ${formatPrice(r.price)} | ${r.airline}`;
    if (r.stops > 0) msg += ` (经停${r.stops})`;
    msg += `\n`;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'Markdown');
}

async function handleAirports(env: Env, chatId: string) {
  let msg = `🛫 *出发机场（慈溪周边）:*\n`;
  for (const a of DEPARTURE_AIRPORTS) {
    msg += `\`${a.iata}\` ${a.name}\n`;
  }

  msg += `\n🛬 *热门目的地:*\n`;
  msg += `*国内:* `;
  msg += POPULAR_DESTINATIONS.filter(a =>
    ['SYX', 'KMG', 'CTU', 'CKG', 'KWE', 'XMN', 'HAK', 'JHG', 'LJG', 'KWL', 'XIY', 'HRB', 'CSX'].includes(a.iata)
  ).map(a => `${a.city}(\`${a.iata}\`)`).join(' ');

  msg += `\n*东南亚:* `;
  msg += POPULAR_DESTINATIONS.filter(a =>
    ['BKK', 'DMK', 'CNX', 'SGN', 'DAD', 'KUL', 'SIN', 'DPS', 'MNL', 'CEB'].includes(a.iata)
  ).map(a => `${a.city}(\`${a.iata}\`)`).join(' ');

  msg += `\n*日韩:* `;
  msg += POPULAR_DESTINATIONS.filter(a =>
    ['NRT', 'KIX', 'ICN'].includes(a.iata)
  ).map(a => `${a.city}(\`${a.iata}\`)`).join(' ');

  msg += `\n\n💡 不在列表里的机场也可以用 IATA 代码添加`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'Markdown');
}

/**
 * 自然语言解析（简单版）
 * 支持: "宁波飞三亚 10月 500以内"
 */
async function handleNaturalInput(env: Env, chatId: string, text: string) {
  // 匹配模式: <城市>飞/到<城市> <月份/日期> <价格>
  const flyMatch = text.match(/([\u4e00-\u9fa5]+)\s*(?:飞|到|去|→)\s*([\u4e00-\u9fa5]+)/);
  if (!flyMatch) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🤔 没听懂，试试这样说：\n` +
      `\`宁波飞三亚 10月 500以内\`\n` +
      `\`杭州去曼谷 11月1日-15日 2000\`\n\n` +
      `或输入 /help 查看完整帮助`,
      'Markdown'
    );
    return;
  }

  const originCity = flyMatch[1];
  const destCity = flyMatch[2];

  // 匹配机场
  const originAirports = searchAirport(originCity);
  const destAirports = searchAirport(destCity);

  if (originAirports.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 找不到"${originCity}"对应的机场\n输入 /airports 查看支持的机场`);
    return;
  }
  if (destAirports.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 找不到"${destCity}"对应的机场\n输入 /airports 查看支持的机场`);
    return;
  }

  const origin = originAirports[0].iata;
  const dest = destAirports[0].iata;

  // 解析月份/日期
  const now = new Date();
  const currentYear = now.getFullYear();
  let dateFrom: string;
  let dateTo: string;

  const monthMatch = text.match(/(\d{1,2})月/);
  const dateRangeMatch = text.match(/(\d{1,2})月(\d{1,2})日?\s*[-~到]\s*(\d{1,2})日?/);
  const fullDateMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (dateRangeMatch) {
    const month = dateRangeMatch[1].padStart(2, '0');
    const dayFrom = dateRangeMatch[2].padStart(2, '0');
    const dayTo = dateRangeMatch[3].padStart(2, '0');
    dateFrom = `${currentYear}-${month}-${dayFrom}`;
    dateTo = `${currentYear}-${month}-${dayTo}`;
  } else if (fullDateMatch) {
    dateFrom = `${fullDateMatch[1]}-${fullDateMatch[2]}-${fullDateMatch[3]}`;
    dateTo = dateFrom;
  } else if (monthMatch) {
    const month = monthMatch[1].padStart(2, '0');
    dateFrom = `${currentYear}-${month}-01`;
    const lastDay = new Date(currentYear, parseInt(month), 0).getDate();
    dateTo = `${currentYear}-${month}-${lastDay}`;
  } else {
    // 默认下个月
    const next = new Date(now);
    next.setMonth(next.getMonth() + 1);
    const month = String(next.getMonth() + 1).padStart(2, '0');
    dateFrom = `${next.getFullYear()}-${month}-01`;
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    dateTo = `${next.getFullYear()}-${month}-${lastDay}`;
  }

  // 解析价格
  const priceMatch = text.match(/(\d+)\s*(?:以内|以下|块|元|¥|rmb)?/i);
  const maxPrice = priceMatch ? parseInt(priceMatch[1]) : 1000;

  // 如果价格看起来不合理（太大或太小），设默认值
  const finalPrice = maxPrice > 50 && maxPrice < 50000 ? maxPrice : 1000;

  // 创建监控
  const user = await getUser(env, chatId);
  if (!user) return;

  await env.DB.prepare(
    `INSERT INTO routes (user_id, origin, destination, date_from, date_to, max_price)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(user.id, origin, dest, dateFrom, dateTo, finalPrice).run();

  const originName = getAirportName(origin);
  const destName = getAirportName(dest);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ 监控已添加！\n\n` +
    `✈️ ${originName} → ${destName}\n` +
    `📅 ${dateFrom} ~ ${dateTo}\n` +
    `💰 低于 ${formatPrice(finalPrice)} 时通知你\n\n` +
    `⏰ 每 6 小时自动查价\n` +
    `📝 /list 查看所有监控 | /check 立即查价`
  );
}

// ============ 工具函数 ============

async function ensureUser(
  env: Env,
  chatId: string,
  username: string,
  name: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (telegram_chat_id, telegram_username, name)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_chat_id) DO UPDATE SET
       telegram_username = excluded.telegram_username,
       name = excluded.name`
  ).bind(chatId, username || null, name || null).run();
}

async function getUser(env: Env, chatId: string) {
  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE telegram_chat_id = ?'
  ).bind(chatId).first<{ id: number }>();

  if (!user) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ 请先 /start 注册');
  }
  return user;
}
