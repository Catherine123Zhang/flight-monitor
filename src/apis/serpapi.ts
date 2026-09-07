/**
 * SerpApi Google Flights API
 * 主数据源 — 聚合所有航司（含春秋/九元等廉航）
 * 免费 100 次/月，$25/1000 次
 * https://serpapi.com/google-flights-api
 */

import type { FlightResult, FlightSearchParams } from '../types';

const SERPAPI_BASE = 'https://serpapi.com/search.json';

interface SerpApiFlightResponse {
  best_flights?: SerpApiFlight[];
  other_flights?: SerpApiFlight[];
  price_insights?: {
    lowest_price: number;
    price_level: string; // "low" | "typical" | "high"
    typical_price_range: [number, number];
    price_history: number[][];
  };
  error?: string;
}

interface SerpApiFlight {
  flights: {
    departure_airport: { name: string; id: string; time: string };
    arrival_airport: { name: string; id: string; time: string };
    duration: number;
    airplane: string;
    airline: string;
    airline_logo: string;
    flight_number: string;
    often_delayed_by_over_30_min?: boolean;
  }[];
  total_duration: number;
  price: number;
  type: string;
  airline_logo: string;
  booking_token?: string;
  layovers?: { name: string; duration: number }[];
}

export async function searchFlights(
  params: FlightSearchParams,
  apiKey: string
): Promise<FlightResult[]> {
  if (!apiKey) return [];

  const url = new URL(SERPAPI_BASE);
  url.searchParams.set('engine', 'google_flights');
  url.searchParams.set('departure_id', params.origin);
  url.searchParams.set('arrival_id', params.destination);
  url.searchParams.set('outbound_date', params.date);
  url.searchParams.set('currency', params.currency || 'CNY');
  url.searchParams.set('hl', 'zh-CN');
  url.searchParams.set('gl', 'cn');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('adults', String(params.adults || 1));

  if (params.return_date) {
    url.searchParams.set('return_date', params.return_date);
    url.searchParams.set('type', '1'); // round trip
  } else {
    url.searchParams.set('type', '2'); // one way
  }

  if (params.children) {
    url.searchParams.set('children', String(params.children));
  }

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error(`SerpApi error: ${resp.status} ${resp.statusText}`);
      return [];
    }

    const data = (await resp.json()) as SerpApiFlightResponse;
    if (data.error) {
      console.error(`SerpApi error: ${data.error}`);
      return [];
    }

    const results: FlightResult[] = [];
    const priceLevel = data.price_insights?.price_level || null;

    const allFlights = [
      ...(data.best_flights || []),
      ...(data.other_flights || []),
    ];

    for (const flight of allFlights) {
      const firstLeg = flight.flights[0];
      const lastLeg = flight.flights[flight.flights.length - 1];
      if (!firstLeg || !flight.price) continue;

      results.push({
        price: flight.price,
        currency: params.currency || 'CNY',
        airline: firstLeg.airline,
        flight_number: firstLeg.flight_number,
        departure_time: firstLeg.departure_airport.time,
        arrival_time: lastLeg.arrival_airport.time,
        stops: flight.flights.length - 1,
        duration_minutes: flight.total_duration,
        source: 'serpapi',
        price_level: priceLevel || undefined,
      });
    }

    // 按价格排序
    results.sort((a, b) => a.price - b.price);
    return results;
  } catch (err) {
    console.error('SerpApi fetch error:', err);
    return [];
  }
}

/**
 * 探索模式 — 从某机场出发最便宜的目的地
 * 使用 Google Flights Explore API
 */
export async function exploreDestinations(
  origin: string,
  apiKey: string,
  month?: string // YYYY-MM
): Promise<{ destination: string; city: string; price: number; currency: string }[]> {
  if (!apiKey) return [];

  // 用 google_travel_explore 引擎
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set('engine', 'google_flights');
  url.searchParams.set('departure_id', origin);
  url.searchParams.set('type', '2'); // one way
  url.searchParams.set('currency', 'CNY');
  url.searchParams.set('hl', 'zh-CN');
  url.searchParams.set('gl', 'cn');
  url.searchParams.set('api_key', apiKey);

  // 设置一个未来的日期范围
  if (month) {
    const [y, m] = month.split('-');
    const firstDay = `${y}-${m}-01`;
    const lastDay = new Date(Number(y), Number(m), 0).toISOString().split('T')[0];
    url.searchParams.set('outbound_date', firstDay);
  } else {
    // 默认查下个月
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    const firstDay = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
    url.searchParams.set('outbound_date', firstDay);
  }

  // 设一个热门目的地试探
  url.searchParams.set('arrival_id', 'SYX'); // 先查三亚获取 price_insights

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = (await resp.json()) as SerpApiFlightResponse;
    // 这里简化处理，实际会通过多个目的地查询汇总
    return [];
  } catch (_err) {
    return [];
  }
}
