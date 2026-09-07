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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
  });
}

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

    // API: Web UI 添加监控航线
    if (url.pathname === '/api/add-route' && request.method === 'POST') {
      const body = (await request.json()) as {
        chat_id: string; origin: string; destination: string;
        date_from: string; date_to: string; max_price: number;
      };

      const user = await env.DB.prepare(
        'SELECT id FROM users WHERE telegram_chat_id = ?'
      ).bind(body.chat_id).first<{ id: number }>();

      if (!user) {
        // 自动创建用户（Web 端注册）
        await env.DB.prepare(
          'INSERT INTO users (telegram_chat_id, name) VALUES (?, ?)'
        ).bind(body.chat_id, 'Web User').run();
        const newUser = await env.DB.prepare(
          'SELECT id FROM users WHERE telegram_chat_id = ?'
        ).bind(body.chat_id).first<{ id: number }>();

        if (!newUser) {
          return jsonResponse({ error: '创建用户失败' }, 500);
        }

        await env.DB.prepare(
          `INSERT INTO routes (user_id, origin, destination, date_from, date_to, max_price)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newUser.id, body.origin.toUpperCase(), body.destination.toUpperCase(),
          body.date_from, body.date_to, body.max_price).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO routes (user_id, origin, destination, date_from, date_to, max_price)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(user.id, body.origin.toUpperCase(), body.destination.toUpperCase(),
          body.date_from, body.date_to, body.max_price).run();
      }

      return jsonResponse({ ok: true });
    }

    // API: Web UI 删除监控航线
    if (url.pathname === '/api/delete-route' && request.method === 'POST') {
      const body = (await request.json()) as { chat_id: string; route_id: number };

      const user = await env.DB.prepare(
        'SELECT id FROM users WHERE telegram_chat_id = ?'
      ).bind(body.chat_id).first<{ id: number }>();

      if (!user) return jsonResponse({ error: 'user not found' }, 404);

      await env.DB.prepare(
        'UPDATE routes SET is_active = 0 WHERE id = ? AND user_id = ?'
      ).bind(body.route_id, user.id).run();

      return jsonResponse({ ok: true });
    }

    // 默认：静态资源由 assets 处理，如果走到这说明是未知 API 路径
    return new Response('Flight Monitor API — visit / for dashboard', {
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
