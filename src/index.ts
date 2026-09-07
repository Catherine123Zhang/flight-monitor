/**
 * Flight Monitor — 机票价格监控系统
 *
 * Cloudflare Worker + D1 + Telegram Bot
 * 多源聚合（SerpApi Google Flights + Sky Scrapper + 春秋航空）
 * 定时查价（Cron 每6小时）+ 低价即时推送
 *
 * @author Vivian Zhang
 */

import type { Env, TelegramUpdate } from './types';
import { handleWebhook } from './bot/telegram';
import { checkAllRoutes } from './monitor/checker';

export default {
  /**
   * HTTP 请求处理
   * - POST /webhook — Telegram webhook
   * - GET /health — 健康检查
   * - POST /setup-webhook — 设置 Telegram webhook URL
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          time: new Date().toISOString(),
          version: '1.0.0',
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    }

    // Telegram Webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = (await request.json()) as TelegramUpdate;
        // 异步处理，不阻塞响应
        ctx.waitUntil(handleWebhook(update, env));
        return new Response('ok');
      } catch (err) {
        console.error('Webhook parse error:', err);
        return new Response('error', { status: 400 });
      }
    }

    // 设置 Telegram Webhook（部署后调一次）
    if (url.pathname === '/setup-webhook') {
      const workerUrl = url.origin;
      const webhookUrl = `${workerUrl}/webhook`;

      const resp = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message', 'callback_query'],
          }),
        }
      );

      const result = await resp.json();
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // 手动触发查价（调试用）
    if (url.pathname === '/trigger-check' && request.method === 'POST') {
      ctx.waitUntil(checkAllRoutes(env));
      return new Response(JSON.stringify({ status: 'triggered' }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // API: 获取路由列表（未来 Web UI 用）
    if (url.pathname === '/api/routes' && request.method === 'GET') {
      const chatId = url.searchParams.get('chat_id');
      if (!chatId) {
        return new Response(JSON.stringify({ error: 'chat_id required' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      const user = await env.DB.prepare(
        'SELECT id FROM users WHERE telegram_chat_id = ?'
      ).bind(chatId).first<{ id: number }>();

      if (!user) {
        return new Response(JSON.stringify({ error: 'user not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      const { results } = await env.DB.prepare(
        'SELECT * FROM routes WHERE user_id = ? AND is_active = 1'
      ).bind(user.id).all();

      return new Response(JSON.stringify({ routes: results }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // API: 获取价格历史（未来 Web UI 用）
    if (url.pathname === '/api/prices' && request.method === 'GET') {
      const routeId = url.searchParams.get('route_id');
      if (!routeId) {
        return new Response(JSON.stringify({ error: 'route_id required' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      const { results } = await env.DB.prepare(
        `SELECT * FROM price_records WHERE route_id = ? ORDER BY checked_at DESC LIMIT 100`
      ).bind(parseInt(routeId)).all();

      return new Response(JSON.stringify({ prices: results }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('Flight Monitor API\n\nEndpoints:\n- POST /webhook\n- GET /health\n- GET /setup-webhook\n- POST /trigger-check\n- GET /api/routes?chat_id=xxx\n- GET /api/prices?route_id=xxx', {
      status: 200,
    });
  },

  /**
   * 定时任务 — 每6小时自动查价
   */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Cron triggered: ${controller.cron} at ${new Date(controller.scheduledTime).toISOString()}`);
    ctx.waitUntil(checkAllRoutes(env));
  },
};
