// The +$100 flight / +$120 hotel margins the pricing rule adds to base prices (Dor: the site is
// built on an average-per-traveller price, and the margin lets a customer who picks a different
// flight or hotel see a minus). Pure constants - imported by price-quote.ts (the rule) and by the
// price light (which strips them to compare our real "from" price), so neither copies the number.
export const FLIGHT_MARGIN_USD = 100;
export const HOTEL_MARGIN_USD = 120;
