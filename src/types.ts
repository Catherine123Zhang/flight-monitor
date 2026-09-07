export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  SERPAPI_KEY: string;
  RAPIDAPI_KEY: string;
}

// ============ Database Models ============

export interface User {
  id: number;
  telegram_chat_id: string;
  telegram_username: string | null;
  name: string | null;
  created_at: string;
  is_active: number;
}

export interface Route {
  id: number;
  user_id: number;
  origin: string;
  destination: string | null;
  date_from: string;
  date_to: string;
  return_from: string | null;
  return_to: string | null;
  max_price: number;
  adults: number;
  children: number;
  is_active: number;
  last_checked_at: string | null;
  created_at: string;
}

export interface PriceRecord {
  id: number;
  route_id: number;
  price: number;
  currency: string;
  airline: string | null;
  flight_number: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  stops: number;
  duration_minutes: number | null;
  source: string;
  booking_url: string | null;
  price_level: string | null;
  checked_at: string;
}

export interface Alert {
  id: number;
  route_id: number;
  price: number;
  airline: string | null;
  message: string | null;
  sent_at: string;
}

// ============ Flight Search Results ============

export interface FlightResult {
  price: number;
  currency: string;
  airline: string;
  flight_number?: string;
  departure_time?: string;
  arrival_time?: string;
  stops: number;
  duration_minutes?: number;
  source: string;
  booking_url?: string;
  price_level?: string; // low/typical/high
}

export interface FlightSearchParams {
  origin: string;       // IATA code
  destination: string;  // IATA code
  date: string;         // YYYY-MM-DD
  return_date?: string;
  adults?: number;
  children?: number;
  currency?: string;
}

// ============ Telegram Types ============

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
    title?: string;
  };
  date: number;
  text?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

// ============ Airport Data ============

export interface Airport {
  iata: string;
  name: string;
  city: string;
  nameEn: string;
}
