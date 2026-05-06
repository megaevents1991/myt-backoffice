import { NextRequest, NextResponse } from 'next/server';
const chromium = require('@sparticuz/chromium');
const playwright = require('playwright-core');

// Dev-mode lookup table so validation works without Chromium
const DEV_AIRLINES: Record<string, { airlineName: string; icaoCode: string }> = {
  LY: { airlineName: 'El Al Israel Airlines', icaoCode: 'ELY' },
  W6: { airlineName: 'Wizz Air', icaoCode: 'WZZ' },
  FR: { airlineName: 'Ryanair', icaoCode: 'RYR' },
  LH: { airlineName: 'Lufthansa', icaoCode: 'DLH' },
  BA: { airlineName: 'British Airways', icaoCode: 'BAW' },
  AF: { airlineName: 'Air France', icaoCode: 'AFR' },
  TK: { airlineName: 'Turkish Airlines', icaoCode: 'THY' },
  LO: { airlineName: 'LOT Polish Airlines', icaoCode: 'LOT' },
  U2: { airlineName: 'easyJet', icaoCode: 'EZY' },
  IB: { airlineName: 'Iberia', icaoCode: 'IBE' },
};

export async function POST(request: NextRequest) {
  try {
    const { airlineCode } = await request.json();

    if (!airlineCode || typeof airlineCode !== 'string') {
      return NextResponse.json(
        { error: 'Airline code is required' },
        { status: 400 }
      );
    }

    // In development, skip Chromium and use the lookup table
    if (process.env.NODE_ENV === 'development') {
      const entry = DEV_AIRLINES[airlineCode.toUpperCase()];
      if (entry) {
        return NextResponse.json({
          success: true,
          airlineName: entry.airlineName,
          airlineLogo: `https://www.avcodes.co.uk/images/logos/${entry.icaoCode.substring(0, 3)}.png`,
          icaoCode: entry.icaoCode,
        });
      }
      return NextResponse.json({ error: 'Airline code not found' }, { status: 404 });
    }

    const browser = await playwright.chromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    });

    const page = await browser.newPage();

    try {
      // Navigate to the airline code search page
      await page.goto('https://www.avcodes.co.uk/airlcodesearch.asp');

      // Wait for the input field to be available
      await page.waitForSelector('body > div.container.mt-2 > main:nth-child(2) > form > div > div:nth-child(2) > input');

      // Enter the airline code
      await page.fill('body > div.container.mt-2 > main:nth-child(2) > form > div > div:nth-child(2) > input', airlineCode);

      // Submit the form (you might need to adjust this based on the actual form submission)
      await page.click('body > div.container.mt-2 > main:nth-child(2) > form button[type="submit"], body > div.container.mt-2 > main:nth-child(2) > form input[type="submit"]');

      // Wait for results (adjust timeout as needed)
      await page.waitForTimeout(2000);

      // Get the page content or specific result elements
      const results = await page.textContent('body');
      
      await browser.close();

      if (!results) {
        return NextResponse.json(
          { error: 'No results found' },
          { status: 404 }
        );
      }

      // Parse airline name and ICAO code from results
      const parseResults = (text: string) => {
        try {
          // Find airline name after "This is Current Data"
          const currentDataMarker = 'This is Current Data';
          const currentDataIndex = text.indexOf(currentDataMarker);
          if (currentDataIndex === -1) {
            // If the primary marker isn't found, we might be on a page without results or an error page.
            // Try to find a common error message or lack of ICAO code as an indicator.
            if (!text.includes("ICAO Code:")) {
              throw new Error('Valid airline data section not found (missing "ICAO Code:" marker).');
            }
            // If ICAO code exists but "This is Current Data" doesn't, it's an unexpected format.
            throw new Error(`"${currentDataMarker}" section not found, but ICAO code was present. Unexpected page format.`);
          }

          // Look for the airline name after "This is Current Data"
          const afterCurrentData = text.substring(currentDataIndex + currentDataMarker.length);
          
          // Regex to capture airline name.
          // It looks for text starting after "This is Current Data",
          // allowing various characters, and stopping before known subsequent markers.
          const nameMatch = afterCurrentData.match(/^\s*([A-Za-z0-9\s\-\.\&\'\/()]+?)\s*(?=Full Name:|IATA Code:|ICAO Code:)/);
          let airlineName = '';
          
          if (nameMatch && nameMatch[1]) {
            // Clean up the airline name - trim and normalize spaces
            airlineName = nameMatch[1].trim().replace(/\s+/g, ' ');
          } else {
            // Fallback or error if name pattern isn't matched after "This is Current Data"
            // This might indicate an unusual airline name format or an empty name field.
            console.warn("Could not directly parse airline name using primary regex. The page structure might have changed or the name is unusual.");
            // As a very basic fallback, you could try to grab the first significant line, but this is risky.
            // For now, we'll rely on the regex and if it fails, airlineName remains empty, triggering later error.
          }

          // Find ICAO code after "ICAO Code: " - this regex seems robust enough.
          // It's applied to the original 'text' as ICAO code might be outside 'afterCurrentData' or easier to find globally.
          const icaoMatch = text.match(/ICAO Code:\s*([A-Z]{3,4})/); // Allow 3 or 4 char ICAO codes
          let icaoCode = '';
          let airlineLogo = '';
          
          if (icaoMatch && icaoMatch[1]) {
            icaoCode = icaoMatch[1];
            // Use only the first 3 chars for the logo URL as per original requirement,
            // even if a 4-char ICAO code is captured.
            airlineLogo = `https://www.avcodes.co.uk/images/logos/${icaoCode.substring(0,3)}.png`;
          }

          return {
            airlineName,
            icaoCode,
            airlineLogo
          };
        } catch (error) {
          // Ensure error is an instance of Error for proper message handling
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to parse results: ${errorMessage}`);
        }
      };

      const parsedData = parseResults(results);

      if (!parsedData.airlineName) {
        return NextResponse.json(
          { error: 'Could not extract airline name from results. The page content might not contain it or the format is unexpected.' },
          { status: 404 }
        );
      }
      if (!parsedData.icaoCode) {
         return NextResponse.json(
          { error: 'Could not extract ICAO code from results. The page content might not contain it or the format is unexpected.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        airlineName: parsedData.airlineName,
        airlineLogo: parsedData.airlineLogo,
        icaoCode: parsedData.icaoCode // Optional: include ICAO code in response
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Airline validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate airline code' },
      { status: 500 }
    );
  }
}