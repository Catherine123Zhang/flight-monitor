/**
 * AI 自然语言解析器
 * 用 Claude API 把用户的自然语言转成结构化的监控参数
 */

import type { Env } from '../types';

export interface ParsedIntent {
  action: 'add_route' | 'list' | 'delete' | 'check' | 'help' | 'chat';
  // add_route 用到的字段
  origins?: string[];       // IATA codes, 可以多个
  destination?: string;     // IATA code
  date_from?: string;       // YYYY-MM-DD
  date_to?: string;         // YYYY-MM-DD
  max_price?: number;       // 人民币
  adults?: number;
  children?: number;
  // delete 用到的
  route_id?: number;
  // AI 的回复（给用户看的）
  reply?: string;
}

const SYSTEM_PROMPT = `你是一个机票价格监控助手。用户会用中文自然语言告诉你他们想监控什么航线，你需要把他们的意图解析成结构化的 JSON。

今天是 ${new Date().toISOString().split('T')[0]}。用户在浙江慈溪，附近机场有：宁波(NGB)、杭州(HGH)、上海浦东(PVG)、上海虹桥(SHA)。

常见目的地 IATA 代码：
国内：三亚SYX、昆明KMG、成都CTU、重庆CKG、贵阳KWE、厦门XMN、海口HAK、西双版纳JHG、丽江LJG、大理DLU、桂林KWL、西安XIY、哈尔滨HRB、长沙CSX、南宁NNG
东南亚：曼谷BKK、清迈CNX、胡志明SGN、岘港DAD、吉隆坡KUL、新加坡SIN、巴厘岛DPS、马尼拉MNL、宿务CEB
日韩：东京NRT、大阪KIX、首尔ICN

规则：
1. 如果用户没指定出发地，默认用所有 4 个机场 [NGB, HGH, PVG, SHA]
2. 如果用户说"上海"，用 PVG 和 SHA 两个
3. 日期要解析成 YYYY-MM-DD 格式。"10月"→当年10月1日到10月31日，"国庆后"→10月8日到10月31日，"下个月"→下月1日到月末
4. 价格：如果用户说"便宜的"且是国内，默认 500；东南亚默认 2000；日韩默认 3000。如果说了具体数字就用具体数字
5. "带娃/带孩子" → children: 1
6. 如果用户不是在说机票（比如闲聊），action 设为 "chat"，reply 里正常回复
7. 如果用户说"看看/列表/有哪些"，action 设为 "list"
8. 如果用户说"删除/取消 + 编号"，action 设为 "delete"
9. 如果用户说"查一下/现在查"，action 设为 "check"

返回纯 JSON，不要 markdown 代码块，格式：
{"action":"add_route","origins":["NGB","HGH","PVG","SHA"],"destination":"SYX","date_from":"2026-10-08","date_to":"2026-10-31","max_price":500,"adults":1,"children":1,"reply":"好的，帮你盯着宁波/杭州/上海飞三亚的机票，10月8日到31日，500以内通知你 ✈️"}`;

export async function parseUserIntent(
  text: string,
  env: Env
): Promise<ParsedIntent> {
  if (!env.CLAUDE_API_KEY) {
    // fallback 到基础解析
    return { action: 'chat', reply: 'AI 解析未配置，请用 /help 查看命令格式' };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!resp.ok) {
      console.error(`Claude API error: ${resp.status}`);
      return { action: 'chat', reply: '理解失败，请再说一次或用 /help 查看命令' };
    }

    const data = (await resp.json()) as {
      content: { type: string; text: string }[];
    };

    const responseText = data.content?.[0]?.text || '';

    // 解析 JSON（处理可能的 markdown 包裹）
    const jsonStr = responseText.replace(/```json\s*|```/g, '').trim();
    const parsed = JSON.parse(jsonStr) as ParsedIntent;

    return parsed;
  } catch (err) {
    console.error('AI parse error:', err);
    return { action: 'chat', reply: '没听懂，你可以说类似"帮我盯宁波飞三亚10月便宜机票"这样的话，或者输入 /help 看帮助' };
  }
}
