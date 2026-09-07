/**
 * 价格监控核心逻辑
 * Cron 触发 → 遍历活跃航线 → 多源查价 → 存记录 → 触发告警
 */

import type { Env, Route, FlightResult, User } from '../types';
import * as serpapi from '../apis/serpapi';
import * as skyscrapper from '../apis/skyscrapper';
import * as spring from '../apis/spring';
import { getAirportName, formatPrice, formatDuration, priceLevelEmoji } from '../utils/airports';
import { sendMessage } from '../bot/telegram';

/**
 * 主检查流程 — 由 Cron 触发
 */
export async function checkAllRoutes(env: Env): Promise<void> {
  // 获取所有活跃监控航线
  const { results: routes } = await env.DB.prepare(
    `SELECT r.*, u.telegram_chat_id
     FROM routes r
     JOIN users u ON r.user_id = u.id
     WHERE r.is_active = 1 AND u.is_active = 1
     ORDER BY r.last_checked_at ASC NULLS FIRST
     LIMIT 20`
  ).all<Route & { telegram_chat_id: string }>();

  if (!routes || routes.length === 0) {
    console.log('No active routes to check');
    return;
  }

  console.log(`Checking ${routes.length} routes...`);

  for (const route of routes) {
    try {
      await checkRoute(route, env);
    } catch (err) {
      console.error(`Error checking route ${route.id}:`, err);
    }
  }
}

/**
 * 检查单条航线
 */
async function checkRoute(
  route: Route & { telegram_chat_id: string },
  env: Env
): Promise<void> {
  // 确定查哪天 — 选 date_from 到 date_to 之间最近的未来日期
  const today = new Date().toISOString().split('T')[0];
  const dateFrom = route.date_from > today ? route.date_from : today;

  if (dateFrom > route.date_to) {
    // 监控日期范围已过，标记不活跃
    await env.DB.prepare('UPDATE routes SET is_active = 0 WHERE id = ?').bind(route.id).run();
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      route.telegram_chat_id,
      `📅 监控 #${route.id} 已到期：${getAirportName(route.origin)} → ${route.destination ? getAirportName(route.destination) : '任意'}\n日期范围 ${route.date_from} ~ ${route.date_to} 已过，自动停止监控。`
    );
    return;
  }

  if (!route.destination) {
    // 探索模式暂不处理（后续迭代）
    return;
  }

  // 多源并发查价
  const searchParams = {
    origin: route.origin,
    destination: route.destination,
    date: dateFrom,
    return_date: route.return_from || undefined,
    adults: route.adults,
    children: route.children,
    currency: 'CNY',
  };

  const [serpResults, skyResults, springResults] = await Promise.allSettled([
    serpapi.searchFlights(searchParams, env.SERPAPI_KEY),
    skyscrapper.searchFlights(searchParams, env.RAPIDAPI_KEY),
    spring.searchFlights(searchParams),
  ]);

  // 合并所有结果
  const allResults: FlightResult[] = [
    ...(serpResults.status === 'fulfilled' ? serpResults.value : []),
    ...(skyResults.status === 'fulfilled' ? skyResults.value : []),
    ...(springResults.status === 'fulfilled' ? springResults.value : []),
  ];

  if (allResults.length === 0) {
    console.log(`Route ${route.id}: no results from any source`);
    await env.DB.prepare(
      'UPDATE routes SET last_checked_at = datetime("now") WHERE id = ?'
    ).bind(route.id).run();
    return;
  }

  // 去重（同航班号+同源去重）& 按价格排序
  const seen = new Set<string>();
  const uniqueResults = allResults.filter(r => {
    const key = `${r.airline}-${r.flight_number}-${r.departure_time}-${r.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.price - b.price);

  // 取最低价
  const cheapest = uniqueResults[0];
  const top5 = uniqueResults.slice(0, 5);

  // 存价格记录（只存前 5 条）
  const insertStmt = env.DB.prepare(
    `INSERT INTO price_records (route_id, price, currency, airline, flight_number,
     departure_time, arrival_time, stops, duration_minutes, source, price_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  await env.DB.batch(
    top5.map(r =>
      insertStmt.bind(
        route.id, r.price, r.currency, r.airline, r.flight_number || null,
        r.departure_time || null, r.arrival_time || null, r.stops,
        r.duration_minutes || null, r.source, r.price_level || null
      )
    )
  );

  // 更新最后检查时间
  await env.DB.prepare(
    'UPDATE routes SET last_checked_at = datetime("now") WHERE id = ?'
  ).bind(route.id).run();

  // 判断是否触发告警 — 两个条件满足任一即推送：
  // 1. 价格低于用户设定阈值
  // 2. Google 标记为 "low"（低于市场价）
  const isBelowThreshold = cheapest.price <= route.max_price;
  const isBelowMarket = cheapest.price_level === 'low';

  if (isBelowThreshold || isBelowMarket) {
    await triggerAlert(route, cheapest, top5, env, { isBelowThreshold, isBelowMarket });
  }
}

/**
 * 触发低价告警
 */
async function triggerAlert(
  route: Route & { telegram_chat_id: string },
  cheapest: FlightResult,
  top5: FlightResult[],
  env: Env,
  reason: { isBelowThreshold: boolean; isBelowMarket: boolean }
): Promise<void> {
  // 检查最近 12 小时内是否已发过类似价格的告警（防刷屏）
  const recentAlert = await env.DB.prepare(
    `SELECT id FROM alerts
     WHERE route_id = ? AND price <= ? AND sent_at > datetime('now', '-12 hours')
     LIMIT 1`
  ).bind(route.id, cheapest.price * 1.05).first();

  if (recentAlert) {
    console.log(`Route ${route.id}: alert already sent recently, skipping`);
    return;
  }

  // 构造推送消息
  const origin = getAirportName(route.origin);
  const dest = getAirportName(route.destination!);

  // 告警原因说明
  let reasonText = '';
  if (reason.isBelowMarket && reason.isBelowThreshold) {
    reasonText = `🟢 低于市场价 + 低于你的阈值 ${formatPrice(route.max_price)}`;
  } else if (reason.isBelowMarket) {
    reasonText = `🟢 Google 标记为低于市场价（当前价 ${formatPrice(cheapest.price)}，你的阈值 ${formatPrice(route.max_price)}）`;
  } else {
    reasonText = `💰 低于你的阈值 ${formatPrice(route.max_price)}`;
  }

  let msg = `🎉 *低价机票发现！*\n\n`;
  msg += `✈️ ${origin} → ${dest}\n`;
  msg += `📅 ${route.date_from}`;
  if (route.date_from !== route.date_to) msg += ` ~ ${route.date_to}`;
  msg += `\n`;
  msg += `👨‍👩‍👧 ${route.adults}大${route.children > 0 ? route.children + '小' : ''}\n`;
  msg += `${reasonText}\n\n`;

  msg += `*最低价 Top 5:*\n`;
  for (let i = 0; i < top5.length; i++) {
    const f = top5[i];
    const level = priceLevelEmoji(f.price_level ?? null);
    msg += `${i + 1}. ${level} *${formatPrice(f.price)}* — ${f.airline}`;
    if (f.flight_number) msg += ` ${f.flight_number}`;
    msg += `\n`;
    if (f.departure_time) msg += `   🕐 ${f.departure_time}`;
    if (f.arrival_time) msg += ` → ${f.arrival_time}`;
    if (f.duration_minutes) msg += ` (${formatDuration(f.duration_minutes)})`;
    msg += `\n`;
    if (f.stops > 0) msg += `   🔄 经停 ${f.stops} 次\n`;
    msg += `   📡 ${f.source}\n`;
  }

  msg += `\n💡 _建议打开去哪儿/携程/春秋官网对比下单_`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, route.telegram_chat_id, msg, 'Markdown');

  // 记录告警
  await env.DB.prepare(
    `INSERT INTO alerts (route_id, price, airline, message) VALUES (?, ?, ?, ?)`
  ).bind(route.id, cheapest.price, cheapest.airline, msg.slice(0, 500)).run();
}
