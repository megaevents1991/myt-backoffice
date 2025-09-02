// app/api/exchange-rates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { multiCurrencyExchangeRateService } from '@/lib/services/ticket-price-sync';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const currency = searchParams.get('currency') as 'EUR' | 'ILS' | 'GBP' | null;

    switch (action) {
      case 'update-all':
        await multiCurrencyExchangeRateService.updateAllExchangeRates();
        return NextResponse.json({ success: true, message: 'All exchange rates updated' });

      case 'update-single':
        if (!currency) {
          return NextResponse.json({ error: 'Currency parameter required for update-single action' }, { status: 400 });
        }
        await multiCurrencyExchangeRateService.updateExchangeRate(currency);
        return NextResponse.json({ success: true, message: `${currency} exchange rate updated` });

      case 'get-all':
        const allRates = multiCurrencyExchangeRateService.getAllExchangeRates();
        return NextResponse.json(allRates);

      case 'get-single':
        if (!currency) {
          return NextResponse.json({ error: 'Currency parameter required for get-single action' }, { status: 400 });
        }
        const singleRate = multiCurrencyExchangeRateService.getExchangeRate(currency);
        return NextResponse.json(singleRate);

      case 'convert':
        const amount = parseFloat(searchParams.get('amount') || '0');
        const fromCurrency = searchParams.get('fromCurrency') as 'EUR' | 'ILS' | 'GBP';
        
        if (!amount || !fromCurrency) {
          return NextResponse.json({ error: 'Amount and fromCurrency parameters required for convert action' }, { status: 400 });
        }
        
        const convertedAmount = multiCurrencyExchangeRateService.convertToUSD(amount, fromCurrency);
        return NextResponse.json({ 
          originalAmount: amount, 
          originalCurrency: fromCurrency, 
          convertedAmount, 
          targetCurrency: 'USD' 
        });

      default:
        return NextResponse.json({ error: 'Invalid action. Supported actions: update-all, update-single, get-all, get-single, convert' }, { status: 400 });
    }
  } catch (error) {
    console.error('Exchange rate API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, currency, amount, fromCurrency } = body;

    switch (action) {
      case 'update-all':
        await multiCurrencyExchangeRateService.updateAllExchangeRates();
        return NextResponse.json({ success: true, message: 'All exchange rates updated' });

      case 'update-single':
        if (!currency) {
          return NextResponse.json({ error: 'Currency parameter required for update-single action' }, { status: 400 });
        }
        await multiCurrencyExchangeRateService.updateExchangeRate(currency);
        return NextResponse.json({ success: true, message: `${currency} exchange rate updated` });

      case 'convert':
        if (!amount || !fromCurrency) {
          return NextResponse.json({ error: 'Amount and fromCurrency parameters required for convert action' }, { status: 400 });
        }
        
        const convertedAmount = multiCurrencyExchangeRateService.convertToUSD(amount, fromCurrency);
        return NextResponse.json({ 
          originalAmount: amount, 
          originalCurrency: fromCurrency, 
          convertedAmount, 
          targetCurrency: 'USD' 
        });

      default:
        return NextResponse.json({ error: 'Invalid action. Supported actions: update-all, update-single, convert' }, { status: 400 });
    }
  } catch (error) {
    console.error('Exchange rate API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
