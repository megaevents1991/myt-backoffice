// Google "write a review" deep links, one per business profile. Offered as
// presets on the form builder's review-link field; a form may still hold any
// other URL. The `#lrd=…,3` anchor opens the write-review dialog directly.
export const GOOGLE_REVIEW_LINKS = [
  {
    key: "mega-travel",
    label: "מגה תיירות",
    url:
      "https://www.google.com/search?q=%D7%9E%D7%92%D7%94+%D7%AA%D7%99%D7%99%D7%A8%D7%95%D7%AA&rlz=1C1OKWM_enIL1194IL1194&oq=%D7%9E%D7%92%D7%94+%D7%AA%D7%99%D7%99%D7%A8%D7%95%D7%AA+&gs_lcrp=EgZjaHJvbWUyBggAEEUYOTIGCAEQIxgnMgkIAhAAGBMYgAQyCQgDEAAYExiABDIJCAQQABgTGIAEMgkIBRAAGBMYgAQyBggGEEUYQTIGCAcQRRg90gEIMTgzOGowajeoAgCwAgA&sourceid=chrome&source=chrome.ob&ie=UTF-8#lrd=0x2a546394ee8a9dc9:0xca45a9d51f54f280,3,,,,",
  },
  {
    key: "mega-events",
    label: "Mega Events",
    // CID 3588250245740006173 (hex 0x31cc06964e8a8b1d) - the Mega Events profile.
    url:
      "https://www.google.com/search?hl=he-IL&gl=il&q=Mega+Events&ludocid=3588250245740006173#lrd=0x0:0x31cc06964e8a8b1d,3,,,,",
  },
] as const;

export type GoogleReviewLinkKey = (typeof GOOGLE_REVIEW_LINKS)[number]["key"];
