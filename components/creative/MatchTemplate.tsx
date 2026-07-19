// Satori has no BiDi algorithm — Hebrew renders in logical (i.e. reversed) order.
// Convert to visual order: split into strong-LTR runs (Latin/digits/currency) vs
// RTL-or-neutral runs, reverse the characters of RTL runs, then reverse run order.
const RTL_CHAR = /[֐-׿]/;
const LTR_CHAR = /[A-Za-z0-9€$₪]/; // Latin, digits, €, $, ₪

export function bidiVisual(text: string): string {
  if (!RTL_CHAR.test(text)) return text;
  const runs: { ltr: boolean; s: string }[] = [];
  for (const ch of text) {
    const ltr = LTR_CHAR.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr) last.s += ch;
    else runs.push({ ltr, s: ch });
  }
  return runs
    .reverse()
    .map((r) => (r.ltr ? r.s : [...r.s].reverse().join("")))
    .join("");
}

// ---------------------------------------------------------------------------
// Brand language — mirrors myt-main lib/og.tsx (dark canvas, neon palette,
// the site's real Figma blob shapes, MegaΣvents. wordmark).
// ---------------------------------------------------------------------------

const CANVAS = "#070618";
const INK = "#FAFAF5";
const MINT = "#5BFF95";
const AQUA = "#45E2FF";
const VIOLET = "#BBA1FF";
const GOLD = "#FACC15";

// Full brand neon palette (same order as the site's EVENT_ART_COLORS).
export const BLOB_HEX = [
  "#5BFF95", // mint
  "#45E2FF", // aqua
  "#BBA1FF", // violet
  "#FF4F61", // coral
  "#FACC15", // gold
  "#FF9D4D", // orange
] as const;

export const BLOB_SHAPES: { d: string; w: number; h: number }[] = [
  {
    d: "M376.567 312.293L311.733 247.245L360.413 239.179C395.964 233.277 409.983 189.739 384.522 164.305L331.689 111.226L370.84 104.771C398.3 100.259 409.156 66.545 389.487 46.8578L338.009 -4.75832C316.883 -25.942 286.807 -35.6261 257.394 -30.7155L185.469 -18.8338C158.009 -14.3216 147.154 19.3922 166.822 39.0795L194.851 67.1655L120.973 79.4455C85.4226 85.3477 71.4037 128.886 96.8645 154.319L133.914 191.587L46.4259 206.105C1.962 213.474 -15.5866 267.975 16.2236 299.904L99.5124 383.449C133.647 417.724 182.326 433.398 230.047 425.48L346.435 406.228C390.829 398.722 408.377 344.222 376.567 312.293Z",
    w: 400,
    h: 358,
  },
  {
    d: "M311.49 43.3357C307.568 14.9081 259.771 22.7798 196.776 58.596C179.306 -13.6957 151.603 -55.2606 127.922 -38.2394C104.241 -21.2181 91.9314 49.1704 95.8559 131.198C35.6311 184.076 -5.24942 239.816 -1.34339 268.128C2.57858 296.556 50.3756 288.684 113.371 252.868C130.86 321.145 157.627 359.699 180.55 343.223C203.473 326.746 215.732 260.141 212.981 181.334C273.956 128.235 315.428 71.8789 311.49 43.3357Z",
    w: 311,
    h: 311,
  },
  {
    d: "M414.973 186.331C410.064 153.061 341.982 130.658 251.657 128.637C228.526 39.1825 190.141 -23.6711 156.104 -20.5852C122.066 -17.4994 102.938 50.637 106.6 141.856C19.8136 160.072 -39.5599 193.893 -34.6713 227.028C-29.7628 260.298 38.3197 282.701 128.644 284.723C151.896 369.849 189.021 428.842 221.97 425.855C254.918 422.868 273.886 358.789 271.815 271.811C359.673 253.841 419.901 219.737 414.973 186.331Z",
    w: 315,
    h: 315,
  },
];

const TAGLINE = "טיסות · מלון · כרטיסים — חבילה אחת";

// The real "MegaΣvents." logotype (exact paths from myt-main's
// components/ui/myt.tsx MYT component, exported from the Figma brand book) —
// NOT hand-typed text. currentColor letterforms → INK; the accent dot stays
// brand mint (hsl(var(--brand-mint)) in the source; satori can't read CSS
// vars, so it's the literal hex here).
function Wordmark({ width }: { width: number }) {
  const height = Math.round((width * 25) / 174);
  return (
    <svg width={width} height={height} viewBox="0 0 174 25" fill="none">
      <path d="M159.788 10.5613C159.616 10.4236 159.435 10.3548 159.246 10.3548C159.039 10.3548 158.859 10.4064 158.704 10.5097C158.549 10.5957 158.472 10.7333 158.472 10.9226C158.472 11.215 158.678 11.4129 159.091 11.5161C159.521 11.6193 160.046 11.6967 160.665 11.7484C161.302 11.7828 161.981 11.8344 162.704 11.9032C163.444 11.9548 164.123 12.0838 164.743 12.2903C165.379 12.4967 165.904 12.8236 166.317 13.2709C166.747 13.701 166.962 14.3118 166.962 15.1032C166.962 16.4451 166.334 17.4515 165.078 18.1225C163.839 18.7934 162.024 19.1289 159.633 19.1289C158.377 19.1289 157.276 19.0343 156.33 18.845C155.401 18.6558 154.609 18.3719 153.956 17.9934C153.302 17.5977 152.777 17.0988 152.381 16.4967C152.003 15.8945 151.745 15.1806 151.607 14.3548C151.521 13.8387 151.745 13.5806 152.278 13.5806H157.052C157.517 13.5806 157.844 13.6408 158.033 13.7612C158.239 13.8817 158.463 14.0537 158.704 14.2774C158.842 14.415 159.039 14.4838 159.298 14.4838C159.521 14.4838 159.71 14.4408 159.865 14.3548C160.037 14.2515 160.123 14.1053 160.123 13.9161C160.123 13.6064 159.908 13.4085 159.478 13.3225C159.065 13.2193 158.541 13.1505 157.904 13.1161C157.285 13.0645 156.605 13.0129 155.865 12.9612C155.143 12.8924 154.463 12.7548 153.827 12.5483C153.207 12.3419 152.683 12.0236 152.252 11.5935C151.84 11.1462 151.633 10.5269 151.633 9.73548C151.633 8.39356 152.252 7.38712 153.491 6.71616C154.73 6.0452 156.536 5.70972 158.91 5.70972C161.405 5.70972 163.28 6.08821 164.536 6.84519C165.809 7.60217 166.583 8.81506 166.859 10.4839C166.945 11 166.721 11.258 166.188 11.258H161.465C161.052 11.258 160.725 11.2064 160.485 11.1032C160.261 10.9828 160.029 10.8021 159.788 10.5613Z" fill={INK}/>
      <path d="M168 16.619C168 15.7932 168.249 15.1308 168.748 14.6319C169.264 14.133 169.935 13.8835 170.761 13.8835C171.587 13.8835 172.249 14.133 172.748 14.6319C173.247 15.1308 173.496 15.7932 173.496 16.619C173.496 17.4448 173.247 18.1071 172.748 18.6061C172.249 19.105 171.587 19.3544 170.761 19.3544C169.935 19.3544 169.264 19.105 168.748 18.6061C168.249 18.1071 168 17.4448 168 16.619Z" fill={MINT}/>
      <path d="M147.18 18.8709C146.045 18.8709 145.107 18.7333 144.367 18.458C143.628 18.1828 143.034 17.7613 142.587 17.1935C142.157 16.6086 141.847 15.8602 141.658 14.9484C141.486 14.0366 141.4 12.9441 141.4 11.671V9.32265C141.4 8.90975 141.228 8.66029 140.884 8.57427C140.591 8.50546 140.385 8.41944 140.264 8.31621C140.161 8.19578 140.109 8.01514 140.109 7.77428V6.74204C140.109 6.26032 140.367 5.98506 140.884 5.91624C141.623 5.79581 142.182 5.46894 142.561 4.93561C142.957 4.38508 143.189 3.52487 143.258 2.35499C143.292 1.83887 143.559 1.58081 144.058 1.58081H147.851C148.367 1.58081 148.625 1.83887 148.625 2.35499V5.19367C148.625 5.70979 148.883 5.96785 149.4 5.96785H150.354C150.871 5.96785 151.129 6.22591 151.129 6.74204V7.77428C151.129 8.29041 150.871 8.54847 150.354 8.54847H149.4C148.883 8.54847 148.625 8.80653 148.625 9.32265V12.1613C148.625 12.4882 148.634 12.7549 148.651 12.9613C148.686 13.1678 148.746 13.3312 148.832 13.4516C148.935 13.5549 149.073 13.6237 149.245 13.6581C149.434 13.6925 149.683 13.7097 149.993 13.7097H150.354C150.871 13.7097 151.129 13.9678 151.129 14.4839V18.0967C151.129 18.6129 150.871 18.8709 150.354 18.8709H147.18Z" fill={INK}/>
      <path d="M130.699 7.87743C130.733 8.18711 130.879 8.34194 131.137 8.34194C131.292 8.34194 131.404 8.30754 131.473 8.23872C131.559 8.1527 131.636 8.04947 131.705 7.92905C132.066 7.34411 132.565 6.82798 133.202 6.38068C133.838 5.93337 134.673 5.70972 135.705 5.70972C136.548 5.70972 137.245 5.82154 137.795 6.0452C138.363 6.25165 138.81 6.54412 139.137 6.92261C139.464 7.28389 139.696 7.7226 139.834 8.23872C139.972 8.73764 140.04 9.27957 140.04 9.86451V18.0967C140.04 18.6128 139.782 18.8708 139.266 18.8708H133.589C133.073 18.8708 132.815 18.6128 132.815 18.0967V11.929C132.815 11.2408 132.574 10.8968 132.092 10.8968C131.817 10.8968 131.61 11.0086 131.473 11.2322C131.335 11.4559 131.266 11.7398 131.266 12.0838V18.0967C131.266 18.6128 131.008 18.8708 130.492 18.8708H124.815C124.299 18.8708 124.041 18.6128 124.041 18.0967V6.74196C124.041 6.22584 124.299 5.96778 124.815 5.96778H129.718C130.234 5.96778 130.518 6.22584 130.569 6.74196L130.699 7.87743Z" fill={INK}/>
      <path d="M116.231 13.8128C116.437 13.486 116.669 13.3225 116.927 13.3225H122.76C123.31 13.3225 123.534 13.5806 123.431 14.0967C123.259 14.9741 122.932 15.7311 122.45 16.3677C121.985 17.0042 121.392 17.5289 120.669 17.9418C119.964 18.3375 119.164 18.6386 118.269 18.845C117.375 19.0343 116.429 19.1289 115.431 19.1289C114.312 19.1289 113.254 18.9999 112.257 18.7418C111.276 18.4666 110.416 18.0537 109.676 17.5031C108.953 16.9526 108.377 16.2558 107.947 15.4128C107.517 14.5698 107.302 13.572 107.302 12.4193C107.302 11.2666 107.508 10.2688 107.921 9.4258C108.334 8.5828 108.893 7.88604 109.599 7.3355C110.321 6.78497 111.155 6.38068 112.102 6.12262C113.065 5.84735 114.089 5.70972 115.173 5.70972C116.205 5.70972 117.177 5.83015 118.089 6.071C119.001 6.29466 119.801 6.65594 120.489 7.15486C121.194 7.65378 121.77 8.29893 122.218 9.09032C122.665 9.86451 122.932 10.8021 123.018 11.9032C123.069 12.4193 122.82 12.6774 122.269 12.6774H115.173C114.897 12.6774 114.7 12.7462 114.579 12.8838C114.459 13.0215 114.441 13.2107 114.527 13.4516C114.7 13.9677 115.001 14.2257 115.431 14.2257C115.792 14.2257 116.059 14.0881 116.231 13.8128ZM115.457 10.0968C115.198 10.0968 115.001 10.1742 114.863 10.329C114.725 10.4666 114.657 10.6301 114.657 10.8193C114.657 10.9742 114.708 11.1118 114.811 11.2322C114.932 11.3355 115.138 11.3871 115.431 11.3871C115.723 11.3871 115.93 11.3355 116.05 11.2322C116.17 11.1118 116.231 10.9742 116.231 10.8193C116.231 10.6129 116.17 10.4408 116.05 10.3032C115.947 10.1656 115.749 10.0968 115.457 10.0968Z" fill={INK}/>
      <path d="M98.99 12.9998C99.0072 13.1374 99.0416 13.2578 99.0932 13.3611C99.1449 13.4471 99.2481 13.4901 99.4029 13.4901C99.5577 13.4901 99.661 13.4471 99.7126 13.3611C99.7642 13.2578 99.7986 13.1374 99.8158 12.9998L100.255 6.4192C100.289 5.90308 100.564 5.64502 101.08 5.64502H107.042C107.558 5.64502 107.764 5.89448 107.661 6.3934L105.209 17.7997C105.106 18.2986 104.796 18.5481 104.28 18.5481H94.5256C94.0094 18.5481 93.6998 18.2986 93.5965 17.7997L91.1449 6.3934C91.0417 5.89448 91.2482 5.64502 91.7643 5.64502H97.7255C98.2588 5.64502 98.5341 5.90308 98.5513 6.4192L98.99 12.9998Z" fill={INK}/>
      <path d="M89.9471 7.91602C90.4116 8.12247 90.6439 8.48375 90.6439 8.99988L90.6439 9.69664C90.6439 10.2128 90.4116 10.5741 89.9471 10.7805L82.1472 13.316C81.9924 13.3848 81.8633 13.4708 81.7601 13.574C81.6397 13.6772 81.5795 13.8493 81.5795 14.0901C81.5795 14.2622 81.6397 14.3826 81.7601 14.4514C81.8806 14.503 82.0268 14.5202 82.1988 14.503L89.8697 13.3869C90.3858 13.3353 90.6439 13.5676 90.6439 14.0837L90.6439 17.9223C90.6439 18.4385 90.3858 18.6965 89.8697 18.6965L73.3538 18.6965C72.8377 18.6965 72.5796 18.4385 72.5796 17.9223L72.5796 13.7482C72.5796 13.2665 72.8032 12.8794 73.2505 12.5869L77.8763 10.1095C78.0139 10.0235 78.1344 9.9289 78.2376 9.82567C78.3236 9.70525 78.3666 9.54181 78.3666 9.33536C78.3666 9.12891 78.3236 8.97407 78.2376 8.87085C78.1344 8.75042 78.0139 8.64719 77.8763 8.56117L73.2505 6.10959C72.8032 5.81712 72.5796 5.43003 72.5796 4.94831L72.5796 0.774172C72.5796 0.258049 72.8377 -1.33627e-05 73.3538 -1.33853e-05L89.8697 -1.41072e-05C90.3858 -1.41298e-05 90.6439 0.258048 90.6439 0.774171L90.6439 4.61283C90.6439 5.12896 90.3858 5.36121 89.8697 5.3096L82.1988 4.19348C82.0268 4.17628 81.8806 4.19348 81.7601 4.2451C81.6397 4.29671 81.5795 4.41714 81.5795 4.60638C81.5795 4.83003 81.6397 5.00208 81.7601 5.1225C81.8633 5.22573 81.9924 5.31175 82.1472 5.38057L89.9471 7.91602Z" fill={INK}/>
      <path d="M64.8525 17.026C64.8352 16.8884 64.7922 16.7766 64.7234 16.6905C64.6718 16.6045 64.5686 16.5615 64.4137 16.5615C64.2589 16.5615 64.1385 16.6045 64.0525 16.6905C63.9836 16.7594 63.9148 16.854 63.846 16.9744C63.5191 17.5421 63.1234 17.9895 62.6589 18.3163C62.1944 18.6432 61.5063 18.8066 60.5944 18.8066C58.9428 18.8066 57.6181 18.2475 56.6203 17.1292C55.6225 15.9938 55.1235 14.3078 55.1235 12.0712C55.1235 10.9186 55.2526 9.92073 55.5106 9.07773C55.7687 8.23473 56.13 7.54657 56.5945 7.01324C57.0762 6.46271 57.6525 6.05841 58.3235 5.80035C58.9945 5.52508 59.7342 5.38745 60.5428 5.38745C61.2138 5.38745 61.7987 5.50788 62.2976 5.74874C62.7966 5.9896 63.2353 6.30787 63.6138 6.70357C63.6998 6.80679 63.7858 6.867 63.8718 6.88421C63.9578 6.90141 64.0267 6.90141 64.0783 6.88421C64.1299 6.867 64.1729 6.8412 64.2073 6.80679C64.2589 6.75518 64.2847 6.66055 64.2847 6.52292V6.4197C64.2847 5.90358 64.5428 5.64551 65.0589 5.64551H70.7362C71.2524 5.64551 71.5104 5.90358 71.5104 6.4197V17.7744C71.5104 18.2905 71.2524 18.5486 70.7362 18.5486H65.8331C65.3342 18.5486 65.0417 18.2905 64.9557 17.7744L64.8525 17.026ZM63.3557 13.6196C63.6482 13.6196 63.8718 13.5078 64.0267 13.2841C64.1987 13.0605 64.2847 12.7766 64.2847 12.4325V11.7616C64.2847 11.4175 64.1987 11.1336 64.0267 10.91C63.8718 10.6863 63.6482 10.5745 63.3557 10.5745C62.7708 10.5745 62.4783 11.082 62.4783 12.097C62.4783 12.5788 62.5471 12.9573 62.6847 13.2325C62.8224 13.4906 63.046 13.6196 63.3557 13.6196Z" fill={INK}/>
      <path d="M45.2353 19.8389C45.8891 19.8389 46.3622 19.6668 46.6547 19.3228C46.9643 18.9959 47.1192 18.4454 47.1192 17.6712C47.1192 17.5163 47.0934 17.4217 47.0418 17.3873C47.0074 17.3357 46.9643 17.3013 46.9127 17.2841C46.8611 17.2669 46.7923 17.2755 46.7063 17.3099C46.6203 17.3271 46.5342 17.3873 46.4482 17.4905C46.0697 17.8862 45.631 18.2045 45.1321 18.4454C44.6332 18.6862 44.0483 18.8066 43.3773 18.8066C42.5687 18.8066 41.8289 18.6776 41.158 18.4196C40.487 18.1443 39.9107 17.74 39.429 17.2067C38.9644 16.6561 38.6032 15.9594 38.3451 15.1164C38.087 14.2734 37.958 13.2755 37.958 12.1229C37.958 9.86912 38.4569 8.18312 39.4548 7.06485C40.4526 5.94658 41.7773 5.38745 43.4289 5.38745C44.3407 5.38745 45.0289 5.55089 45.4934 5.87777C45.9579 6.20465 46.3536 6.65195 46.6805 7.21969C46.7493 7.34012 46.8181 7.44334 46.8869 7.52936C46.9729 7.59818 47.0934 7.63259 47.2482 7.63259C47.4031 7.63259 47.5063 7.58958 47.5579 7.50355C47.6267 7.41753 47.6697 7.30571 47.6869 7.16808L47.7901 6.4197C47.8762 5.90357 48.1686 5.64551 48.6676 5.64551H53.5707C54.0868 5.64551 54.3449 5.90357 54.3449 6.4197V18.0067C54.3449 19.2626 54.2073 20.3292 53.932 21.2066C53.6567 22.1012 53.2266 22.8238 52.6417 23.3743C52.0568 23.9421 51.2998 24.355 50.3708 24.613C49.4589 24.8711 48.3579 25.0001 47.0676 25.0001H40.487C39.9709 25.0001 39.7128 24.7421 39.7128 24.2259V20.6131C39.7128 20.097 39.9709 19.8389 40.487 19.8389H45.2353ZM46.1902 10.5745C45.8805 10.5745 45.6568 10.7121 45.5192 10.9874C45.3816 11.2454 45.3128 11.6153 45.3128 12.097C45.3128 13.1121 45.6052 13.6196 46.1902 13.6196C46.4826 13.6196 46.7063 13.5078 46.8611 13.2841C47.0332 13.0605 47.1192 12.7766 47.1192 12.4325V11.7616C47.1192 11.4175 47.0332 11.1336 46.8611 10.91C46.7063 10.6863 46.4826 10.5745 46.1902 10.5745Z" fill={INK}/>
      <path d="M29.8894 13.8128C30.0958 13.486 30.3281 13.3225 30.5861 13.3225H36.4183C36.9689 13.3225 37.1925 13.5806 37.0893 14.0967C36.9172 14.9741 36.5904 15.7311 36.1087 16.3677C35.6441 17.0042 35.0506 17.5289 34.328 17.9418C33.6227 18.3375 32.8227 18.6386 31.9281 18.845C31.0334 19.0343 30.0872 19.1289 29.0894 19.1289C27.9711 19.1289 26.9131 18.9999 25.9152 18.7418C24.9346 18.4666 24.0744 18.0537 23.3346 17.5031C22.612 16.9526 22.0357 16.2558 21.6056 15.4128C21.1755 14.5698 20.9604 13.572 20.9604 12.4193C20.9604 11.2666 21.1669 10.2688 21.5798 9.4258C21.9927 8.5828 22.5518 7.88604 23.2572 7.3355C23.9798 6.78497 24.8142 6.38068 25.7604 6.12262C26.7238 5.84735 27.7475 5.70972 28.8313 5.70972C29.8636 5.70972 30.8356 5.83015 31.7474 6.071C32.6592 6.29466 33.4592 6.65594 34.1474 7.15486C34.8528 7.65378 35.4291 8.29893 35.8764 9.09032C36.3237 9.86451 36.5904 10.8021 36.6764 11.9032C36.728 12.4193 36.4785 12.6774 35.928 12.6774H28.8313C28.5561 12.6774 28.3582 12.7462 28.2378 12.8838C28.1174 13.0215 28.1001 13.2107 28.1862 13.4516C28.3582 13.9677 28.6593 14.2257 29.0894 14.2257C29.4507 14.2257 29.7173 14.0881 29.8894 13.8128ZM29.1152 10.0968C28.8571 10.0968 28.6593 10.1742 28.5216 10.329C28.384 10.4666 28.3152 10.6301 28.3152 10.8193C28.3152 10.9742 28.3668 11.1118 28.47 11.2322C28.5905 11.3355 28.7969 11.3871 29.0894 11.3871C29.3819 11.3871 29.5883 11.3355 29.7087 11.2322C29.8292 11.1118 29.8894 10.9742 29.8894 10.8193C29.8894 10.6129 29.8292 10.4408 29.7087 10.3032C29.6055 10.1656 29.4077 10.0968 29.1152 10.0968Z" fill={INK}/>
      <path d="M11.587 18.174C11.3805 18.6385 11.0192 18.8707 10.5031 18.8707H9.80633C9.29021 18.8707 8.92892 18.6385 8.72247 18.174L6.18702 9.56763C6.1182 9.41279 6.03218 9.28376 5.92896 9.18053C5.82573 9.06011 5.65369 8.99989 5.41284 8.99989C5.2408 8.99989 5.12037 9.06011 5.05155 9.18053C4.99994 9.30096 4.98273 9.4472 4.99994 9.61924L6.11605 18.0966C6.16767 18.6127 5.93541 18.8707 5.41929 18.8707H0.774184C0.258061 18.8707 0 18.6127 0 18.0966V0.774185C0 0.258062 0.258061 0 0.774184 0H5.75477C6.23648 0 6.62357 0.223653 6.91604 0.67096L9.39343 4.49027C9.47945 4.6279 9.57408 4.74833 9.6773 4.85155C9.79773 4.93757 9.96117 4.98059 10.1676 4.98059C10.3741 4.98059 10.5289 4.93757 10.6321 4.85155C10.7526 4.74833 10.8558 4.6279 10.9418 4.49027L13.3934 0.67096C13.6859 0.223653 14.0729 0 14.5547 0H19.5352C20.0514 0 20.3094 0.258062 20.3094 0.774185V18.0966C20.3094 18.6127 20.0514 18.8707 19.5352 18.8707H14.8901C14.374 18.8707 14.1418 18.6127 14.1934 18.0966L15.3095 9.61924C15.3267 9.4472 15.3095 9.30096 15.2579 9.18053C15.2063 9.06011 15.0858 8.99989 14.8966 8.99989C14.6729 8.99989 14.5009 9.06011 14.3805 9.18053C14.2772 9.28376 14.1912 9.41279 14.1224 9.56763L11.587 18.174Z" fill={INK}/>
    </svg>
  );
}

// The site's category photo backgrounds (same assets og.tsx uses, served from
// prod so satori can fetch them from anywhere).
export const PHOTO_BG = {
  football: "https://www.mega-events.co.il/art-backgrounds/football.jpg",
  tennis: "https://www.mega-events.co.il/art-backgrounds/tennis.jpg",
  cars: "https://www.mega-events.co.il/art-backgrounds/cars.jpg",
} as const;
export type CardBgKind = "blob" | keyof typeof PHOTO_BG;

export type CreativeInput = {
  // "match" = two subjects + VS; "artist" = single subject; "photo" = event's
  // own photo when nothing matched at all (no name pairs with it — always
  // rendered like a no-cutout subject, see hasCutout below).
  kind: "match" | "artist" | "photo";
  homeLogoUrl: string;       // match: home image; artist: artist image; photo: event photo
  homeName: string;          // match: home name; artist: artist name; photo: event name
  awayLogoUrl?: string;      // match only
  awayName?: string;         // match only
  // Whether each subject's image is a REAL transparent cut-out (a dedicated
  // logo/art_image_url) vs a regular photo (image_url/card_image_url).
  // Mirrors myt-main's lib/og.tsx personOgImage: a real cut-out sits inside a
  // blob/photo-bg card; a regular photo instead gets a plain circular avatar
  // with a color glow — no blob shape, no forced background, since a
  // rectangular photo crammed onto a blob shape (or a stock stadium photo
  // behind a snapshot) looks wrong. "photo" kind is always non-cutout by
  // definition. Missing/undefined defaults to true (assume a real cutout) so
  // any caller not yet passing this keeps today's blob-card look.
  homeHasCutout?: boolean;
  awayHasCutout?: boolean;   // match only
  dateText: string;          // "14.09.2026"
  timeText: string | null;   // "21:00" or null → omitted
  locationText: string;      // "Santiago Bernabéu, Madrid"
  priceText: string;         // "החל מ-€499" / "כרטיסים החל מ-€99"
  // Design-base mode: render the full branded canvas (glows, wordmark, names,
  // date/price) but WITHOUT blob cards and subject images — a background the
  // designer drops a not-yet-cut photo onto.
  bare?: boolean;
  // Card background: brand blob (default for artists) or a category photo
  // (default "football" for matches). Designer-overridable.
  bgKind?: CardBgKind;
  // Blob color/shape overrides (brand palette index 0-5 / shape 0-2).
  // null/undefined = the template's defaults per card.
  colorIndex?: number | null;
  shapeIndex?: number | null;
  // Designer sizing controls, all neutral by default. Scales are 0.5–2 (1 =
  // 100%); offsets are % of the card the image sits in (X+ = right, Y+ = down).
  // Match mode applies the same transform to both sides.
  imgScale?: number | null;
  imgOffsetX?: number | null;
  imgOffsetY?: number | null;
  bgScale?: number | null;
};

export function buildPriceText(mode: "package" | "ticket", price: number, currency: string): string {
  return mode === "ticket" ? `כרטיסים החל מ-${currency}${price}` : `חבילות החל מ-${currency}${price}`;
}

// Deterministic string → positive int (same technique as render.tsx's blob
// seed) — used to pick a stable-per-subject, varied-across-subjects
// color/shape when the designer hasn't explicitly overridden either.
function hashSeed(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// One site-style card: dark rounded card, brand blob (or a category photo)
// covering it, image on top.
function BlobCard({
  img, color, shapeIndex, w, h, radius, photoUrl,
  imgScale = 1, imgOffsetX = 0, imgOffsetY = 0, bgScale = 1,
}: {
  img: string;
  color: string;
  shapeIndex: number;
  w: number;
  h: number;
  radius: number;
  photoUrl?: string | null;
  imgScale?: number;
  imgOffsetX?: number;
  imgOffsetY?: number;
  bgScale?: number;
}) {
  const shape = BLOB_SHAPES[shapeIndex % BLOB_SHAPES.length];
  // bgScale folds into the cover factor so blob stays centered while zooming.
  const cover = Math.max(w / shape.w, h / shape.h) * 1.05 * bgScale;
  const bw = Math.round(shape.w * cover);
  const bh = Math.round(shape.h * cover);
  // Subject image: scaled dimensions + px offsets (satori-safe, no transform).
  const iw = Math.round((w - 24) * imgScale);
  const ih = Math.round((h - 40) * imgScale);
  const ox = Math.round((imgOffsetX / 100) * w);
  const oy = Math.round((imgOffsetY / 100) * h);
  const pw = Math.round(w * bgScale);
  const ph = Math.round(h * bgScale);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        width: w,
        height: h,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: "#0D0C1E",
        position: "relative",
        boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
      }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          width={pw}
          height={ph}
          alt=""
          style={{ position: "absolute", top: (h - ph) / 2, left: (w - pw) / 2, width: pw, height: ph, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: (h - bh) / 2,
            left: (w - bw) / 2,
            width: bw,
            height: bh,
          }}
        >
          <svg width={bw} height={bh} viewBox={`0 0 ${shape.w} ${shape.h}`}>
            <path d={shape.d} fill={color} />
          </svg>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        width={iw}
        height={ih}
        alt=""
        style={{ width: iw, height: ih, objectFit: "contain", position: "relative", left: ox, top: oy }}
      />
    </div>
  );
}

// No-cutout fallback (mirrors myt-main's lib/og.tsx personOgImage): a plain
// circular avatar, the photo cropped to fill it, ringed by a brand-color
// glow — no blob shape, no card, no forced category background. Used for any
// subject whose only available image is a regular photo, not a transparent
// cut-out.
function AvatarCircle({
  img, color, size, imgScale = 1, imgOffsetX = 0, imgOffsetY = 0,
}: {
  img: string;
  color: string;
  size: number;
  imgScale?: number;
  imgOffsetX?: number;
  imgOffsetY?: number;
}) {
  const pw = Math.round(size * imgScale);
  const ox = Math.round((imgOffsetX / 100) * size);
  const oy = Math.round((imgOffsetY / 100) * size);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 9999,
        overflow: "hidden",
        backgroundColor: color,
        boxShadow: `0 0 ${Math.round(size * 0.3)}px ${color}66`,
        position: "relative",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        width={pw}
        height={pw}
        alt=""
        style={{
          position: "relative",
          left: ox,
          top: oy,
          width: pw,
          height: pw,
          objectFit: "cover",
        }}
      />
    </div>
  );
}

export function MatchTemplate({
  kind, homeLogoUrl, awayLogoUrl, homeName, awayName,
  homeHasCutout, awayHasCutout,
  dateText, timeText, locationText, priceText, bare,
  bgKind, colorIndex, shapeIndex,
  imgScale, imgOffsetX, imgOffsetY, bgScale,
  width, height, bgUrl,
}: CreativeInput & { width: number; height: number; bgUrl: string }) {
  const isSquare = height > 700;
  void bgUrl; // brand gradient canvas replaced the static background asset

  // Designer sizing controls — neutral unless overridden.
  const iScale = imgScale ?? 1;
  const iOffX = imgOffsetX ?? 0;
  const iOffY = imgOffsetY ?? 0;
  const bScale = bgScale ?? 1;
  const sizing = {
    imgScale: iScale,
    imgOffsetX: iOffX,
    imgOffsetY: iOffY,
    bgScale: bScale,
  };

  const isSingleSubject = kind === "artist" || kind === "photo";
  // "photo" kind is non-cutout by definition (it IS the fallback path); for
  // "match"/"artist", missing/undefined defaults to true (assume a real
  // cut-out) so existing callers that don't pass this yet keep today's look.
  const homeIsCutout = kind === "photo" ? false : homeHasCutout ?? true;
  const awayIsCutout = awayHasCutout ?? true;
  const bothCutouts = homeIsCutout && awayIsCutout;

  const cardW = kind === "artist" ? (isSquare ? 520 : 330) : isSquare ? 380 : 250;
  const cardH = kind === "artist" ? (isSquare ? 560 : 380) : isSquare ? 440 : 300;
  // No-cutout circular avatar diameter — reuses the same footprint as the
  // card it replaces, so layouts don't jump between cutout/photo events.
  const avatarSize = isSingleSubject ? (isSquare ? 460 : 300) : cardW;
  // Wide stadium panel (photo-bg match mode): one panel, both logos inside.
  const panelW = width - 2 * (isSquare ? 56 : 48);
  const panelH = isSquare ? 560 : 340;
  const panelLogo = isSquare ? 290 : 185;

  // Card background: explicit choice wins; default = football photo for
  // matches, brand blob for artists. A stock category photo (stadium etc.)
  // only makes sense behind REAL logos — skip it (plain canvas instead) when
  // either match side is a regular photo, not a cut-out.
  const effectiveBg: CardBgKind = bgKind ?? (kind === "match" ? "football" : "blob");
  const photoUrl =
    effectiveBg !== "blob" && (kind !== "match" || bothCutouts) ? PHOTO_BG[effectiveBg] : null;
  // Color/shape: explicit override wins; otherwise seeded from the subject's
  // own identity (same hash shape as renderBlobPng) so auto-generated
  // creatives (cron + "auto" in the manual designer) get real variety instead
  // of every single one landing on the same fixed mint/aqua/violet + shape.
  // Stable across re-renders of the SAME event (deterministic on its name +
  // date), varied ACROSS different events.
  const seed = hashSeed(
    kind === "match" ? `${homeName}|${awayName ?? ""}|${dateText}` : `${homeName}|${dateText}`,
  );
  const seedColor = seed % BLOB_HEX.length;
  // Unsigned shift — seed can exceed 2^31-1 (still valid from >>>0 in
  // hashSeed); a signed `>>` would ToInt32 that negative and produce a
  // negative shape index (undefined.d crash in BlobCard's <path>).
  const seedShape = (seed >>> 3) % BLOB_SHAPES.length;
  // Away card gets the next palette entry/shape so the two sides never come
  // out identical (matches the explicit-override behavior below).
  const homeColor = colorIndex != null ? BLOB_HEX[colorIndex % BLOB_HEX.length] : BLOB_HEX[seedColor];
  const awayColor =
    colorIndex != null ? BLOB_HEX[(colorIndex + 1) % BLOB_HEX.length] : BLOB_HEX[(seedColor + 1) % BLOB_HEX.length];
  const artistColor = colorIndex != null ? BLOB_HEX[colorIndex % BLOB_HEX.length] : BLOB_HEX[seedColor];
  const homeShape = shapeIndex != null ? shapeIndex % BLOB_SHAPES.length : seedShape;
  const awayShape =
    shapeIndex != null ? (shapeIndex + 1) % BLOB_SHAPES.length : (seedShape + 1) % BLOB_SHAPES.length;
  const artistShape = shapeIndex != null ? shapeIndex % BLOB_SHAPES.length : seedShape;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: CANVAS,
        fontFamily: "brand",
        color: INK,
      }}
    >
      {/* neon glows */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          background: `radial-gradient(${Math.round(width * 0.55)}px ${Math.round(height * 0.5)}px at 22% 40%, ${AQUA}33, transparent 70%)`,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          background: `radial-gradient(${Math.round(width * 0.55)}px ${Math.round(height * 0.5)}px at 78% 45%, ${MINT}33, transparent 70%)`,
          display: "flex",
        }}
      />

      {/* header: real wordmark logo + tagline */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: isSquare ? 44 : 22 }}>
        <Wordmark width={isSquare ? 300 : 220} />
        <div style={{ display: "flex", fontSize: isSquare ? 24 : 17, color: "rgba(250,250,245,0.72)", marginTop: isSquare ? 14 : 10 }}>
          {bidiVisual(TAGLINE)}
        </div>
      </div>

      {/* main */}
      {isSingleSubject ? (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {bare ? (
            <div style={{ display: "flex", width: cardW, height: cardH }} />
          ) : homeIsCutout || photoUrl ? (
            // A real cut-out always gets the blob/photo-bg card; a regular
            // photo ALSO gets it when a stock category photo (e.g. football
            // stadium) was explicitly requested — a contained photo sitting
            // on a matching realistic photo backdrop reads fine (unlike a
            // photo crammed onto an abstract colored blob, which doesn't).
            <BlobCard img={homeLogoUrl} color={artistColor} shapeIndex={artistShape} w={cardW} h={cardH} radius={isSquare ? 76 : 54} photoUrl={photoUrl} {...sizing} />
          ) : (
            /* No real cut-out and no stock photo background — plain circular
               avatar with a color glow, no blob shape (matches myt-main's
               og.tsx fallback for a person with only a regular photo). */
            <AvatarCircle img={homeLogoUrl} color={artistColor} size={avatarSize} imgScale={iScale} imgOffsetX={iOffX} imgOffsetY={iOffY} />
          )}
          <div style={{ display: "flex", fontSize: isSquare ? 58 : 38, fontWeight: 700, marginTop: isSquare ? 24 : 12, textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>
            {bidiVisual(homeName)}
          </div>
        </div>
      ) : photoUrl && !bare ? (
        /* photo background: ONE wide stadium panel holding both logos + VS */
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: `0 ${isSquare ? 56 : 48}px` }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: panelW,
              height: panelH,
              borderRadius: isSquare ? 56 : 40,
              overflow: "hidden",
              position: "relative",
              backgroundColor: "#0D0C1E",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
              padding: `0 ${isSquare ? 56 : 44}px`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              width={Math.round(panelW * bScale)}
              height={Math.round(panelH * bScale)}
              alt=""
              style={{
                position: "absolute",
                top: Math.round((panelH - panelH * bScale) / 2),
                left: Math.round((panelW - panelW * bScale) / 2),
                width: Math.round(panelW * bScale),
                height: Math.round(panelH * bScale),
                objectFit: "cover",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={awayLogoUrl ?? ""} alt="" style={{ width: Math.round(panelLogo * iScale), height: Math.round(panelLogo * iScale), objectFit: "contain", position: "relative", left: Math.round((iOffX / 100) * panelLogo), top: Math.round((iOffY / 100) * panelLogo) }} />
              <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 10px rgba(0,0,0,0.9)" }}>
                {bidiVisual(awayName ?? "")}
              </div>
            </div>
            <div style={{ display: "flex", fontSize: isSquare ? 108 : 66, fontWeight: 700, color: INK, textShadow: `0 0 40px ${MINT}99, 0 4px 14px rgba(0,0,0,0.9)`, position: "relative" }}>
              VS
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={homeLogoUrl} alt="" style={{ width: Math.round(panelLogo * iScale), height: Math.round(panelLogo * iScale), objectFit: "contain", position: "relative", left: Math.round((iOffX / 100) * panelLogo), top: Math.round((iOffY / 100) * panelLogo) }} />
              <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 10px rgba(0,0,0,0.9)" }}>
                {bidiVisual(homeName)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", padding: `0 ${isSquare ? 64 : 56}px` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW }}>
            {bare ? (
              <div style={{ display: "flex", width: cardW, height: cardH }} />
            ) : awayIsCutout ? (
              <BlobCard img={awayLogoUrl ?? ""} color={awayColor} shapeIndex={awayShape} w={cardW} h={cardH} radius={36} {...sizing} />
            ) : (
              <AvatarCircle img={awayLogoUrl ?? ""} color={awayColor} size={avatarSize} imgScale={iScale} imgOffsetX={iOffX} imgOffsetY={iOffY} />
            )}
            <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}>
              {bidiVisual(awayName ?? "")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: isSquare ? 108 : 66, fontWeight: 700, color: INK, textShadow: `0 0 40px ${MINT}99, 0 4px 14px rgba(0,0,0,0.8)` }}>
              VS
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW }}>
            {bare ? (
              <div style={{ display: "flex", width: cardW, height: cardH }} />
            ) : homeIsCutout ? (
              <BlobCard img={homeLogoUrl} color={homeColor} shapeIndex={homeShape} w={cardW} h={cardH} radius={36} {...sizing} />
            ) : (
              <AvatarCircle img={homeLogoUrl} color={homeColor} size={avatarSize} imgScale={iScale} imgOffsetX={iOffX} imgOffsetY={iOffY} />
            )}
            <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}>
              {bidiVisual(homeName)}
            </div>
          </div>
        </div>
      )}

      {/* footer: date/location + price pill */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: isSquare ? 48 : 22 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: isSquare ? 34 : 23, color: "rgba(250,250,245,0.88)" }}>
          <div style={{ display: "flex" }}>{timeText ? `${dateText} | ${timeText}` : dateText}</div>
          {locationText ? (
            <div style={{ display: "flex", marginLeft: 18 }}>{`· ${bidiVisual(locationText)}`}</div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: isSquare ? 20 : 10,
            padding: isSquare ? "14px 44px" : "8px 28px",
            borderRadius: 999,
            backgroundColor: GOLD,
            color: CANVAS,
            fontSize: isSquare ? 44 : 28,
            fontWeight: 700,
            boxShadow: `0 0 60px ${GOLD}55`,
          }}
        >
          {bidiVisual(priceText)}
        </div>
      </div>
    </div>
  );
}
