-- Price light: clear catalog junk out of competitor_listings.detail_text.
--
-- `detail_text is not null` is how the crawl's detail queue reads "this listing's detail page was
-- already opened" (price-light-crawl.ts `listingIdsWorthDetail`). Two catalog parsers wrote
-- something else into that column, so their listings never reached the queue and the comparison
-- sheet showed "לא פורסם" for flight / hotel / ticket (staff note, 2026-09-17):
--
--   * ISSTA      - the card's marketing tagline ("ברצלונה-ריאל מדריד. מוריניו חוזר לקאמפ נואו"), all 46 rows.
--   * LiveEvents - the board's status cell ("פסח"), and '' on /show/ tier pages, which the crawler
--                  now follows to their cheapest /package/ page.
--
-- Both parsers emit null from now on; this clears what they left behind so those listings queue.
-- A real ISSTA text is the summary issta.ts writes ("טיסה: ... | מלון: ... | כרטיס: ..."); a real
-- LiveEvents text is a whole package page (thousands of characters; the fixture check asserts
-- > 200). Backoffice-only table - the main app never reads it. Idempotent.

update "public"."competitor_listings"
   set "detail_text" = null
 where "detail_text" is not null
   and (
     ("competitor" = 'issta'
        and "detail_text" not like 'טיסה:%'
        and "detail_text" not like 'מלון:%'
        and "detail_text" not like 'כרטיס:%')
     or ("competitor" = 'liveevents' and length("detail_text") < 200)
   );
