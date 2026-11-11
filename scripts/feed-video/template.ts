// The three feed-video styles as one HTML page each, ported from the mockups Dor approved on
// 11.11 (.superpowers/brainstorm/.../style-directions-v3.html). The page is 270x338 CSS px and
// is captured at deviceScaleFactor 4 = 1080x1352, cropped to 1080x1350 (4:5). Every moving part
// is a CSS animation on a 10 s loop, so the capture steps `currentTime` frame by frame.
//
// `data-fit` boxes shrink their font until the text fits; the capture fails the video when one
// still overflows at its minimum, and when a picture does not load - never a video with a hole.

import type { VideoStyle } from "./config";

export type VideoPage = {
  style: VideoStyle;
  hook: string; // the AI line a person approved
  name: string; // the artist, as the site names them
  place: string; // creativePlaceText - the show's city
  date: string; // DD.MM.YYYY
  priceText: string | null; // buildPriceText; null = the price beat is off
  tagline: string; // creativeTagline
  cta: string; // "טיסה + מלון + כרטיס" / "כרטיס בלבד"
  cutout: string;
  photos: string[];
  cutoutInC: boolean;
  logoSvg: string; // the real MegaΣvents. wordmark, light ink
  fontDataUrl: string; // Rubik (app/fonts) as a data: URL - a file:// font is blocked by CORS
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The hook in three beats for style B, balanced by length; needs at least three words. */
export function hookBeats(hook: string): [string, string, string] {
  const words = hook.trim().split(/\s+/);
  if (words.length < 3) throw new Error(`hook needs 3+ words for style B: "${hook}"`);
  let best: [string, string, string] = [words[0], words[1], words.slice(2).join(" ")];
  let bestScore = Infinity;
  for (let i = 1; i < words.length - 1; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const parts: [string, string, string] = [
        words.slice(0, i).join(" "),
        words.slice(i, j).join(" "),
        words.slice(j).join(" "),
      ];
      const lens = parts.map((p) => p.length);
      const score = Math.max(...lens) - Math.min(...lens);
      if (score < bestScore) {
        bestScore = score;
        best = parts;
      }
    }
  }
  return best;
}

const BASE_CSS = `
  html,body{margin:0;padding:0;background:#0A0E1A}
  .m{width:270px;height:338px;overflow:hidden;position:relative;background:#0A0E1A;font-family:Rubik,system-ui,sans-serif}
  .m *{box-sizing:border-box}
  .abs{position:absolute}
  .nw{white-space:nowrap}
  .logo svg{display:block;margin:0 auto}
`;

const A_CSS = `
  .a-bg{inset:0;background:radial-gradient(120% 80% at 50% 40%,#13213a 0%,#0A0E1A 70%)}
  .a-logo{top:16px;width:100%;animation:a-logo 10s infinite}
  .a-tag{top:42px;left:12px;right:12px;text-align:center;color:#9aa4b2;font-size:10.5px;font-weight:600;animation:a-logo 10s infinite}
  @keyframes a-logo{0%,22%{opacity:0}26%,96%{opacity:1}100%{opacity:0}}
  .a-hook{inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;font-weight:900;font-size:27px;line-height:1.15;padding:24px;animation:a-hook 10s infinite}
  @keyframes a-hook{0%{opacity:0;transform:scale(.96)}3%,20%{opacity:1;transform:none}24%,100%{opacity:0;transform:scale(1.03)}}
  .a-box{top:62px;left:20px;width:230px;height:128px;border-radius:16px;overflow:hidden;background:#0d1424;animation:a-box 10s infinite}
  @keyframes a-box{0%,23%{opacity:0}26%,96%{opacity:1}100%{opacity:0}}
  .a-yel{inset:0;background:#FACC15;clip-path:polygon(28% 0,100% 0,100% 12%,42% 100%,0 100%,0 82%,28% 50%);transform-origin:right;animation:a-yel 10s infinite}
  @keyframes a-yel{0%,24%{transform:scaleX(0);opacity:1}30%,96%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
  .a-pic{bottom:-2px;left:50%;height:132px;max-width:none;transform:translateX(-50%);animation:a-pic 10s infinite}
  @keyframes a-pic{0%,27%{opacity:0;transform:translate(-50%,40px)}33%,96%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
  .a-name{top:198px;left:10px;right:10px;height:38px;text-align:center;color:#fff;font-weight:900;font-size:30px;animation:a-name 10s infinite}
  @keyframes a-name{0%,36%{opacity:0;transform:translateY(10px)}40%,96%{opacity:1;transform:none}100%{opacity:0}}
  .a-when{top:240px;left:10px;right:10px;height:24px;text-align:center;color:#d6dbe3;font-weight:800;font-size:18px;animation:a-when 10s infinite}
  @keyframes a-when{0%,50%{opacity:0;transform:translateY(10px)}54%,96%{opacity:1;transform:none}100%{opacity:0}}
  .a-pill{top:276px;left:24px;right:24px;height:40px;padding:0 12px;border-radius:999px;background:#5BFF95;color:#0A1A14;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center;animation:a-pill 10s infinite}
  @keyframes a-pill{0%,64%{opacity:0;transform:scale(.6)}68%{opacity:1;transform:scale(1.08);box-shadow:0 0 0 rgba(91,255,149,0)}71%,96%{opacity:1;transform:scale(1);box-shadow:0 0 22px rgba(91,255,149,.55)}100%{opacity:0}}
`;

function pageA(p: VideoPage): string {
  return `
  <div class="abs a-bg"></div>
  <div class="abs a-hook" data-fit="box" data-min="16">${esc(p.hook)}</div>
  <div class="abs a-logo logo">${p.logoSvg}</div>
  <div class="abs a-tag nw" data-fit="line" data-min="8">${esc(p.tagline)}</div>
  <div class="abs a-box"><div class="abs a-yel"></div><img class="abs a-pic" src="${esc(p.cutout)}" alt=""></div>
  <div class="abs a-name nw" data-fit="line" data-min="18">${esc(p.name)}</div>
  <div class="abs a-when nw" data-fit="line" data-min="12">${esc(p.place)} &bull; ${esc(p.date)}</div>
  <div class="abs a-pill nw" data-fit="line" data-min="12">${esc(p.priceText ?? p.cta)}</div>`;
}

const B_CSS = `
  .b-ph{inset:0;background-size:cover;background-position:center;opacity:0}
  .b-p1{animation:b-p1 10s infinite}.b-p2{animation:b-p2 10s infinite}.b-p3{animation:b-p3 10s infinite}
  .b-p4{background-position:70% center;animation:b-p4 10s infinite}
  @keyframes b-p1{0%{opacity:1;transform:scale(1.15)}11.9%{opacity:1;transform:scale(1.0)}12%,100%{opacity:0}}
  @keyframes b-p2{0%,11.9%{opacity:0}12%{opacity:1;transform:scale(1.15)}23.9%{opacity:1;transform:scale(1)}24%,100%{opacity:0}}
  @keyframes b-p3{0%,23.9%{opacity:0}24%{opacity:1;transform:scale(1.15)}35.9%{opacity:1;transform:scale(1)}36%,100%{opacity:0}}
  @keyframes b-p4{0%,51.9%{opacity:0}52%{opacity:1;transform:scale(1.25)}65.9%{opacity:1;transform:scale(1.1)}66%,100%{opacity:0}}
  .b-green{inset:0;background:#5BFF95;opacity:0;animation:b-green 10s infinite}
  @keyframes b-green{0%,35.9%{opacity:0}36%,51.9%{opacity:1}52%,100%{opacity:0}}
  .b-cut{bottom:0;left:50%;height:230px;max-width:none;transform:translateX(-50%);opacity:0;animation:b-cut 10s infinite}
  @keyframes b-cut{0%,35.9%{opacity:0;transform:translate(-50%,30px)}37%{opacity:1;transform:translate(-50%,0)}51.9%{opacity:1;transform:translate(-50%,0) scale(1.05)}52%,100%{opacity:0}}
  .b-dark{inset:0;background:#0A0E1A;opacity:0;animation:b-dark 10s infinite}
  @keyframes b-dark{0%,65.9%{opacity:0}66%,100%{opacity:1}}
  .b-shade{inset:0;background:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,.15) 60%,rgba(0,0,0,.35))}
  .b-t{inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;font-weight:900;opacity:0;padding:16px;line-height:1.1}
  .b-t1{font-size:40px;animation:b-t1 10s infinite}@keyframes b-t1{0%{opacity:1;transform:scale(1.3)}2%,11.9%{opacity:1;transform:none}12%,100%{opacity:0}}
  .b-t2{font-size:40px;animation:b-t2 10s infinite}@keyframes b-t2{0%,11.9%{opacity:0}12%{opacity:1;transform:scale(1.3)}14%,23.9%{opacity:1;transform:none}24%,100%{opacity:0}}
  .b-t3{font-size:40px;animation:b-t3 10s infinite}@keyframes b-t3{0%,23.9%{opacity:0}24%{opacity:1;transform:scale(1.3)}26%,35.9%{opacity:1;transform:none}36%,100%{opacity:0}}
  .b-t4{font-size:52px;color:#0A1A14;justify-content:flex-start;padding-top:26px;animation:b-t4 10s infinite}@keyframes b-t4{0%,35.9%{opacity:0}36%{opacity:1;transform:scale(1.4)}38%,51.9%{opacity:1;transform:none}52%,100%{opacity:0}}
  .b-t5{font-size:42px;animation:b-t5 10s infinite}@keyframes b-t5{0%,51.9%{opacity:0}52%{opacity:1;transform:translateX(40px)}54%,65.9%{opacity:1;transform:none}66%,100%{opacity:0}}
  .b-t5 .d{font-size:.57em;background:#5BFF95;color:#0A1A14;padding:2px 10px;border-radius:6px;margin-top:6px}
  .b-t6{font-size:56px;animation:b-t6 10s infinite}@keyframes b-t6{0%,65.9%{opacity:0}66%{opacity:1;transform:scale(1.5)}68%,83.9%{opacity:1;transform:none}84%,100%{opacity:0}}
  .b-t6 .s{font-size:.29em;color:#9aa4b2;font-weight:600}.b-t6 .p{color:#5BFF95;text-shadow:0 0 24px rgba(91,255,149,.5)}
  .b-t7{font-size:16px;animation:b-t7 10s infinite}@keyframes b-t7{0%,83.9%{opacity:0}84%{opacity:1;transform:translateY(20px)}86%,98%{opacity:1;transform:none}100%{opacity:0}}
  .b-t7 .cta{margin-top:14px;background:#5BFF95;color:#0A1A14;padding:9px 18px;border-radius:999px}
`;

function pageB(p: VideoPage): string {
  if (p.photos.length < 3) throw new Error("style B needs three stage photos");
  const [t1, t2, t3] = hookBeats(p.hook);
  const bg = (cls: string, url: string) =>
    `<div class="abs b-ph ${cls}" style="background-image:url('${esc(url)}')"></div>`;
  const priceBeat = p.priceText
    ? (() => {
        // "ממוצע לנוסע $1,933" -> the label small above, the amount big.
        const m = /^(.*?)\s*(\$[\d,]+)$/.exec(p.priceText);
        return m
          ? `<div class="s nw">${esc(m[1])}</div><div class="p nw">${esc(m[2])}</div>`
          : `<div class="p nw">${esc(p.priceText)}</div>`;
      })()
    : `<div class="s nw">הכל בהזמנה אחת</div><div class="p nw">${esc(p.cta)}</div>`;
  return `
  ${bg("b-p1", p.photos[0])}${bg("b-p2", p.photos[1])}${bg("b-p3", p.photos[2])}
  <div class="abs b-green"></div>
  <img class="abs b-cut" src="${esc(p.cutout)}" alt="">
  ${bg("b-p4", p.photos[0])}
  <div class="abs b-dark"></div>
  <div class="abs b-shade"></div>
  <div class="abs b-t b-t1" data-fit="box" data-min="20">${esc(t1)}</div>
  <div class="abs b-t b-t2" data-fit="box" data-min="20">${esc(t2)}</div>
  <div class="abs b-t b-t3" data-fit="box" data-min="20">${esc(t3)}</div>
  <div class="abs b-t b-t4 nw" data-fit="line" data-min="22">${esc(p.name)}</div>
  <div class="abs b-t b-t5" data-fit="box" data-min="18"><div class="c nw">${esc(p.place)}</div><div class="d nw">${esc(p.date)}</div></div>
  <div class="abs b-t b-t6" data-fit="box" data-min="20">${priceBeat}</div>
  <div class="abs b-t b-t7" data-fit="box" data-min="10"><div class="logo">${p.logoSvg}</div><div class="cta nw">${esc(p.cta)}</div></div>`;
}

const C_CSS = `
  .c-ph{inset:-10px;background-size:cover;background-position:center}
  .c-p1{animation:c-p1 10s infinite}
  .c-p2{opacity:0;background-position:30% center;animation:c-p2 10s infinite}
  @keyframes c-p1{0%{opacity:1;transform:scale(1.25) translateX(10px)}40%{opacity:1;transform:scale(1.1) translateX(-6px)}48%,100%{opacity:0}}
  @keyframes c-p2{0%,36%{opacity:0;transform:scale(1.2);filter:blur(0)}46%{opacity:1}60%{opacity:1;transform:scale(1.08);filter:blur(0)}68%,96%{opacity:1;transform:scale(1.05);filter:blur(5px) brightness(.45)}100%{opacity:0}}
  .c-solo{animation:c-solo 10s infinite}
  @keyframes c-solo{0%{transform:scale(1.22) translateX(8px);filter:blur(0)}60%{transform:scale(1.08) translateX(-4px);filter:blur(0)}68%,96%{transform:scale(1.05);filter:blur(5px) brightness(.45)}100%{transform:scale(1.05);filter:blur(5px) brightness(.45)}}
  .c-scrim{inset:0;background:linear-gradient(to top,rgba(0,0,0,.78) 0%,rgba(0,0,0,.45) 30%,transparent 55%);animation:c-hook 10s infinite}
  .c-sweep{inset:0;background:linear-gradient(115deg,transparent 35%,rgba(170,220,255,.35) 50%,transparent 65%);mix-blend-mode:screen;animation:c-sweep 5s ease-in-out infinite}
  @keyframes c-sweep{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
  .c-vig{inset:0;background:radial-gradient(90% 70% at 50% 45%,transparent 40%,rgba(0,0,0,.75) 100%)}
  .c-hook{bottom:44px;left:16px;right:16px;height:90px;display:flex;align-items:flex-end;justify-content:center;text-align:center;color:#fff;font-weight:600;font-size:22px;line-height:1.25;letter-spacing:.5px;text-shadow:0 2px 12px rgba(0,0,0,.8);animation:c-hook 10s infinite}
  @keyframes c-hook{0%,5%{opacity:0;transform:translateY(8px)}12%,36%{opacity:1;transform:none}42%,100%{opacity:0}}
  .c-cut{bottom:0;left:50%;height:250px;max-width:none;transform:translateX(-50%);animation:c-cut 10s infinite}
  @keyframes c-cut{0%,62%{opacity:0;transform:translate(-50%,40px)}70%,96%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
  .c-card{bottom:14px;left:14px;right:14px;height:100px;border-radius:14px;background:rgba(10,14,26,.55);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.15);color:#fff;padding:10px 14px;animation:c-card 10s infinite}
  @keyframes c-card{0%,68%{opacity:0;transform:translateY(20px)}74%,96%{opacity:1;transform:none}100%{opacity:0}}
  .c-card .n{font-weight:900;font-size:24px;height:30px}
  .c-card .w{font-size:13px;color:#cbd5e1;font-weight:600;height:18px}
  .c-card .p{position:absolute;left:12px;right:12px;bottom:12px;height:30px;font-size:15px;display:flex;align-items:center;justify-content:flex-end}
  .c-card .p span{background:#5BFF95;color:#0A1A14;font-weight:900;font-size:1em;border-radius:999px;padding:6px 12px}
  .c-logo{top:14px;width:100%;opacity:.9;animation:c-logo 10s infinite}
  @keyframes c-logo{0%,66%{opacity:0}72%,96%{opacity:.9}100%{opacity:0}}
`;

function pageC(p: VideoPage): string {
  if (p.photos.length < 1) throw new Error("style C needs a stage photo");
  // Two photos dissolve into each other; a single photo is one slow zoom - the same photo
  // dissolving into itself reads as a double exposure.
  const photos =
    p.photos.length >= 2
      ? `<div class="abs c-ph c-p1" style="background-image:url('${esc(p.photos[1])}')"></div>
  <div class="abs c-ph c-p2" style="background-image:url('${esc(p.photos[0])}')"></div>`
      : `<div class="abs c-ph c-solo" style="background-image:url('${esc(p.photos[0])}')"></div>`;
  return `
  ${photos}
  <div class="abs c-sweep"></div>
  <div class="abs c-vig"></div>
  <div class="abs c-scrim"></div>
  <div class="abs c-logo logo">${p.logoSvg}</div>
  <div class="abs c-hook" data-fit="box" data-min="14">${esc(p.hook)}</div>
  ${p.cutoutInC ? `<img class="abs c-cut" src="${esc(p.cutout)}" alt="">` : ""}
  <div class="abs c-card">
    <div class="n nw" data-fit="line" data-min="14">${esc(p.name)}</div>
    <div class="w nw" data-fit="line" data-min="9">${esc(p.place)} &bull; ${esc(p.date)}</div>
    <div class="p" data-fit="line" data-min="9"><span class="nw">${esc(p.priceText ?? p.cta)}</span></div>
  </div>`;
}

export function videoHtml(p: VideoPage): string {
  const css = { A: A_CSS, B: B_CSS, C: C_CSS }[p.style];
  const body = { A: pageA, B: pageB, C: pageC }[p.style](p);
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>@font-face{font-family:Rubik;src:url(${p.fontDataUrl}) format("woff2");font-weight:300 900;font-display:block}
${BASE_CSS}${css}</style></head>
<body><div class="m" dir="rtl">${body}</div></body></html>`;
}
