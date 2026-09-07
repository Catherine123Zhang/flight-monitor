/**
 * Sky Scrapper API (RapidAPI)
 * 备用数据源 — Skyscanner 数据
 * 免费 100 次/月
 * https://rapidapi.com/apiheya/api/sky-scrapper
 */

import type { FlightResult, FlightSearchParams } from '../types';

const RAPIDAPI_HOST = 'sky-scrapper.p.rapidapi.com';

interface SkyscrapperResponse {
  status: boolean;
  data?: {
    itineraries?: SkyscrapperItinerary[];
    context?: {
      status: string;
      totalResults: number;
    };
  };
}

interface SkyscrapperItinerary {
  id: string;
  price: {
    raw: number;
    formatted: string;
  };
  legs: {
    id: string;
    origin: { id: string; name: string; displayCode: string };
    destination: { id: string; name: string; displayCode: string };
    durationInMinutes: number;
    stopCount: number;
    departure: string;
    arrival: string;
    carriers: {
      marketing: { id: number; name: string; logoUrl: string }[];
    };
    segments: {
      flightNumber: string;
      marketingCarrier: { name: string };
    }[];
  }[];
  score: number;
}

// Sky Scrapper 需要 entityId 而非 IATA code，这里做映射
// 需要先调 /api/v1/flights/searchAirport 获取 entityId
const AIRPORT_ENTITY_CACHE: Record<string, string> = {};

async function getEntityId(
  iata: string,
  apiKey: string
): Promise<string | null> {
  if (AIRPORT_ENTITY_CACHE[iata]) return AIRPORT_ENTITY_CACHE[iata];

  try {
    const resp = await fetch(
      `https://${RAPIDAPI_HOST}/api/v1/flights/searchAirport?query=${iata}&locale=zh-CN`,
      {
        headers: {
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': apiKey,
        },
      }
    );

    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      status: boolean;
      data?: { entityId: string; skyId: string }[];
    };

    if (data.status && data.data?.[0]) {
      const entityId = data.data[0].entityId;
      AIRPORT_ENTITY_CACHE[iata] = entityId;
      return entityId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function searchFlights(
  params: FlightSearchParams,
  apiKey: string
): Promise<FlightResult[]> {
  if (!apiKey) return [];

  // 先获取 entityId
  const [originEntity, destEntity] = await Promise.all([
    getEntityId(params.origin, apiKey),
    getEntityId(params.destination, apiKey),
  ]);

  if (!originEntity || !destEntity) {
    console.error('Sky Scrapper: could not resolve airport entityIds');
    return [];
  }

  const url = new URL(`https://${RAPIDAPI_HOST}/api/v2/flights/searchFlightsComplete`);
  url.searchParams.set('originSkyId', params.origin);
  url.searchParams.set('destinationSkyId', params.destination);
  url.searchParams.set('originEntityId', originEntity);
  url.searchParams.set('destinationEntityId', destEntity);
  url.searchParams.set('date', params.date);
  url.searchParams.set('adults', String(params.adults || 1));
  url.searchParams.set('currency', params.currency || 'CNY');
  url.searchParams.set('market', 'CN');
  url.searchParams.set('locale', 'zh-CN');

  if (params.return_date) {
    url.searchParams.set('returnDate', params.return_date);
  }
  if (params.children) {
    url.searchParams.set('children', String(params.children));
  }

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      },
    });

    if (!resp.ok) {
      console.error(`Sky Scrapper error: ${resp.status}`);
      return [];
    }

    const data = (await resp.json()) as SkyscrapperResponse;
    if (!data.status || !data.data?.itineraries) return [];

    const results: FlightResult[] = [];

    for (const itin of data.data.itineraries.slice(0, 20)) {
      const firstLeg = itin.legs[0];
      if (!firstLeg) continue;

      const airline = firstLeg.carriers?.marketing?.[0]?.name || 'Unknown';
      const flightNum = firstLeg.segments?.[0]?.flightNumber || '';

      results.push({
        price: itin.price.raw,
        currency: params.currency || 'CNY',
        airline,
        flight_number: flightNum,
        departure_time: firstLeg.departure,
        arrival_time: firstLeg.arrival,
        stops: firstLeg.stopCount,
        duration_minutes: firstLeg.durationInMinutes,
        source: 'skyscrapper',
      });
    }

    results.sort((a, b) => a.price - b.price);
    return results;
  } catch (err) {
    console.error('Sky Scrapper fetch error:', err);
    return [];
  }
}
