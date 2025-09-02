// lib/services/exchange-rate-client.ts

export type SupportedCurrency = 'EUR' | 'ILS' | 'GBP';

export interface ExchangeRateData {
  rate: number;
  lastUpdated: Date;
  source: 'api' | 'fallback';
}

export interface ExchangeRates {
  [key: string]: ExchangeRateData;
  EUR: ExchangeRateData;
  ILS: ExchangeRateData;
  GBP: ExchangeRateData;
}

export interface ConvertResult {
  originalAmount: number;
  originalCurrency: SupportedCurrency;
  convertedAmount: number;
  targetCurrency: 'USD';
}

class ExchangeRateClientService {
  private async makeRequest(url: string, options?: RequestInit) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async updateAllExchangeRates(): Promise<void> {
    await this.makeRequest('/api/exchange-rates?action=update-all');
  }

  async updateExchangeRate(currency: SupportedCurrency): Promise<void> {
    await this.makeRequest(`/api/exchange-rates?action=update-single&currency=${currency}`);
  }

  async getAllExchangeRates(): Promise<ExchangeRates> {
    return this.makeRequest('/api/exchange-rates?action=get-all');
  }

  async getExchangeRate(currency: SupportedCurrency): Promise<ExchangeRateData> {
    return this.makeRequest(`/api/exchange-rates?action=get-single&currency=${currency}`);
  }

  async convertToUSD(amount: number, fromCurrency: SupportedCurrency): Promise<number> {
    const result: ConvertResult = await this.makeRequest(
      `/api/exchange-rates?action=convert&amount=${amount}&fromCurrency=${fromCurrency}`
    );
    return result.convertedAmount;
  }
}

// Create a singleton instance
export const exchangeRateClientService = new ExchangeRateClientService();
