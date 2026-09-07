import type { Airport } from '../types';

// 出发机场（慈溪周边）
export const DEPARTURE_AIRPORTS: Airport[] = [
  { iata: 'NGB', name: '宁波栎社机场', city: '宁波', nameEn: 'Ningbo Lishe' },
  { iata: 'HGH', name: '杭州萧山机场', city: '杭州', nameEn: 'Hangzhou Xiaoshan' },
  { iata: 'PVG', name: '上海浦东机场', city: '上海', nameEn: 'Shanghai Pudong' },
  { iata: 'SHA', name: '上海虹桥机场', city: '上海', nameEn: 'Shanghai Hongqiao' },
];

// 热门亲子游目的地
export const POPULAR_DESTINATIONS: Airport[] = [
  // 国内热门
  { iata: 'SYX', name: '三亚凤凰机场', city: '三亚', nameEn: 'Sanya Phoenix' },
  { iata: 'KMG', name: '昆明长水机场', city: '昆明', nameEn: 'Kunming Changshui' },
  { iata: 'CTU', name: '成都天府机场', city: '成都', nameEn: 'Chengdu Tianfu' },
  { iata: 'CKG', name: '重庆江北机场', city: '重庆', nameEn: 'Chongqing Jiangbei' },
  { iata: 'KWE', name: '贵阳龙洞堡机场', city: '贵阳', nameEn: 'Guiyang Longdongbao' },
  { iata: 'XMN', name: '厦门高崎机场', city: '厦门', nameEn: 'Xiamen Gaoqi' },
  { iata: 'HAK', name: '海口美兰机场', city: '海口', nameEn: 'Haikou Meilan' },
  { iata: 'JHG', name: '西双版纳嘎洒机场', city: '西双版纳', nameEn: 'Xishuangbanna Gasa' },
  { iata: 'LJG', name: '丽江三义机场', city: '丽江', nameEn: 'Lijiang Sanyi' },
  { iata: 'DLU', name: '大理荒草坝机场', city: '大理', nameEn: 'Dali Huangcaoba' },
  { iata: 'ZHA', name: '湛江吴川机场', city: '湛江', nameEn: 'Zhanjiang Wuchuan' },
  { iata: 'NNG', name: '南宁吴圩机场', city: '南宁', nameEn: 'Nanning Wuxu' },
  { iata: 'KWL', name: '桂林两江机场', city: '桂林', nameEn: 'Guilin Liangjiang' },
  { iata: 'WNZ', name: '温州龙湾机场', city: '温州', nameEn: 'Wenzhou Longwan' },
  { iata: 'CSX', name: '长沙黄花机场', city: '长沙', nameEn: 'Changsha Huanghua' },
  { iata: 'XIY', name: '西安咸阳机场', city: '西安', nameEn: 'Xian Xianyang' },
  { iata: 'HRB', name: '哈尔滨太平机场', city: '哈尔滨', nameEn: 'Harbin Taiping' },
  // 东南亚（廉航多）
  { iata: 'BKK', name: '曼谷素万那普', city: '曼谷', nameEn: 'Bangkok Suvarnabhumi' },
  { iata: 'DMK', name: '曼谷廊曼', city: '曼谷', nameEn: 'Bangkok Don Mueang' },
  { iata: 'CNX', name: '清迈机场', city: '清迈', nameEn: 'Chiang Mai' },
  { iata: 'SGN', name: '胡志明新山一', city: '胡志明', nameEn: 'Ho Chi Minh Tan Son Nhat' },
  { iata: 'DAD', name: '岘港机场', city: '岘港', nameEn: 'Da Nang' },
  { iata: 'KUL', name: '吉隆坡机场', city: '吉隆坡', nameEn: 'Kuala Lumpur' },
  { iata: 'SIN', name: '新加坡樟宜', city: '新加坡', nameEn: 'Singapore Changi' },
  { iata: 'DPS', name: '巴厘岛机场', city: '巴厘岛', nameEn: 'Bali Ngurah Rai' },
  { iata: 'MNL', name: '马尼拉机场', city: '马尼拉', nameEn: 'Manila Ninoy Aquino' },
  { iata: 'CEB', name: '宿务机场', city: '宿务', nameEn: 'Cebu Mactan' },
  // 日韩
  { iata: 'NRT', name: '东京成田', city: '东京', nameEn: 'Tokyo Narita' },
  { iata: 'KIX', name: '大阪关西', city: '大阪', nameEn: 'Osaka Kansai' },
  { iata: 'ICN', name: '首尔仁川', city: '首尔', nameEn: 'Seoul Incheon' },
];

// IATA code → 中文名映射
export function getAirportName(iata: string): string {
  const all = [...DEPARTURE_AIRPORTS, ...POPULAR_DESTINATIONS];
  const found = all.find(a => a.iata === iata.toUpperCase());
  return found ? `${found.city}(${found.iata})` : iata;
}

// 搜索机场（模糊匹配中文/英文/IATA）
export function searchAirport(query: string): Airport[] {
  const q = query.toLowerCase().trim();
  const all = [...DEPARTURE_AIRPORTS, ...POPULAR_DESTINATIONS];
  return all.filter(a =>
    a.iata.toLowerCase().includes(q) ||
    a.name.includes(q) ||
    a.city.includes(q) ||
    a.nameEn.toLowerCase().includes(q)
  );
}

// 格式化飞行时长
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

// 格式化价格
export function formatPrice(price: number, currency = 'CNY'): string {
  if (currency === 'CNY') return `¥${price}`;
  if (currency === 'USD') return `$${price}`;
  return `${price} ${currency}`;
}

// 价格等级 emoji
export function priceLevelEmoji(level: string | null): string {
  switch (level) {
    case 'low': return '🟢';
    case 'typical': return '🟡';
    case 'high': return '🔴';
    default: return '⚪';
  }
}
