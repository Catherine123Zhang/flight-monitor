/**
 * 春秋航空直接接口
 * 补充数据源 — 廉航专杀
 * 免费，无需 API key
 * 接口: https://flights.ch.com/Flights/MinPriceTrends
 */

import type { FlightResult, FlightSearchParams } from '../types';

const SPRING_API = 'https://flights.ch.com';

interface SpringPriceTrend {
  dateStr: string;      // "2026-10-15"
  minPrice: number;     // 最低价（不含税）
  tax: number;          // 税费
  isLowest: boolean;    // 是否本月最低
}

interface SpringSearchResult {
  flightList?: SpringFlight[];
}

interface SpringFlight {
  flightNo: string;
  depTime: string;       // "08:30"
  arrTime: string;       // "11:45"
  depCityName: string;
  arrCityName: string;
  depAirport: string;
  arrAirport: string;
  minPrice: number;
  tax: number;
  stops: number;
  duration: string;      // "3h15m"
}

/**
 * 获取春秋航空某航线的价格趋势（按月）
 */
export async function getPriceTrends(
  origin: string,
  destination: string,
  month: string // YYYY-MM
): Promise<{ date: string; price: number; isLowest: boolean }[]> {
  try {
    const resp = await fetch(`${SPRING_API}/Flights/MinPriceTrends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        DepartureCode: origin,
        ArrivalCode: destination,
        Month: month,
        IsInternational: false,
      }),
    });

    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: SpringPriceTrend[] };
    if (!data.data) return [];

    return data.data
      .filter(d => d.minPrice > 0)
      .map(d => ({
        date: d.dateStr,
        price: d.minPrice + d.tax,
        isLowest: d.isLowest,
      }));
  } catch (err) {
    console.error('Spring Airlines price trend error:', err);
    return [];
  }
}

/**
 * 搜索春秋航空具体日期航班
 */
export async function searchFlights(
  params: FlightSearchParams
): Promise<FlightResult[]> {
  try {
    // 春秋航空的搜索接口
    const resp = await fetch(`${SPRING_API}/Flights/Search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        DepartureCode: params.origin,
        ArrivalCode: params.destination,
        DepartureDate: params.date,
        IsInternational: false,
        AdultCount: params.adults || 1,
        ChildCount: params.children || 0,
      }),
    });

    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: SpringSearchResult };
    if (!data.data?.flightList) return [];

    return data.data.flightList.map(f => ({
      price: f.minPrice + f.tax,
      currency: 'CNY',
      airline: '春秋航空',
      flight_number: f.flightNo,
      departure_time: f.depTime,
      arrival_time: f.arrTime,
      stops: f.stops || 0,
      duration_minutes: parseDuration(f.duration),
      source: 'spring',
    }));
  } catch (err) {
    console.error('Spring Airlines search error:', err);
    return [];
  }
}

function parseDuration(dur: string): number | undefined {
  if (!dur) return undefined;
  const hMatch = dur.match(/(\d+)h/);
  const mMatch = dur.match(/(\d+)m/);
  const hours = hMatch ? parseInt(hMatch[1]) : 0;
  const mins = mMatch ? parseInt(mMatch[1]) : 0;
  return hours * 60 + mins || undefined;
}
