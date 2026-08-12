/**
 * TEMPORARY design-exploration script v2 (not committed, deleted after).
 * Round 2 - structurally different compositions, not variations of one skeleton.
 * Run: npx -y tsx --tsconfig scripts/__poc-tsconfig.json scripts/__concepts.tsx
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ImageResponse } from "next/og";
import { bidiVisual } from "../components/creative/MatchTemplate";

const OUT =
  "C:/Users/doraz/AppData/Local/Temp/claude/C--Users-doraz-OneDrive-Desktop-Work-MegaEvent-MYT-Git-Shered-myt-backoffice/fb3f34c0-623d-43b2-8810-3f076be22f4a/scratchpad/concepts2";

const FONT_URL =
  "https://fandqafngybfdyslofmr.supabase.co/storage/v1/object/public/creatives/assets/font.ttf";
const PHOTO =
  "https://fandqafngybfdyslofmr.supabase.co/storage/v1/object/public/templates/migrated/45hOXCEgABgyoebCFpJb4T.jpeg";
const PHOTO2 =
  "https://fandqafngybfdyslofmr.supabase.co/storage/v1/object/public/card_images/ariane.jpg";
const CUTOUT =
  "https://fandqafngybfdyslofmr.supabase.co/storage/v1/object/public/templates/ariana-grande-art-tight.png";

const CANVAS = "#070618";
const INK = "#FAFAF5";
const MINT = "#5BFF95";
const AQUA = "#45E2FF";
const W = 1080;
const H = 1080;

const NAME = "אריאנה גרנדה";
const DATE = "15.08.2026";
const CITY = "לונדון";
const LOC = "לונדון, בריטניה";

// Local Wordmark copy with a fill override so it works on LIGHT surfaces too.
function Wordmark({ width, fill = INK, dot = MINT }: { width: number; fill?: string; dot?: string }) {
  const height = Math.round((width * 25) / 174);
  return (
    <svg width={width} height={height} viewBox="0 0 174 25" fill="none">
      <path d="M159.788 10.5613C159.616 10.4236 159.435 10.3548 159.246 10.3548C159.039 10.3548 158.859 10.4064 158.704 10.5097C158.549 10.5957 158.472 10.7333 158.472 10.9226C158.472 11.215 158.678 11.4129 159.091 11.5161C159.521 11.6193 160.046 11.6967 160.665 11.7484C161.302 11.7828 161.981 11.8344 162.704 11.9032C163.444 11.9548 164.123 12.0838 164.743 12.2903C165.379 12.4967 165.904 12.8236 166.317 13.2709C166.747 13.701 166.962 14.3118 166.962 15.1032C166.962 16.4451 166.334 17.4515 165.078 18.1225C163.839 18.7934 162.024 19.1289 159.633 19.1289C158.377 19.1289 157.276 19.0343 156.33 18.845C155.401 18.6558 154.609 18.3719 153.956 17.9934C153.302 17.5977 152.777 17.0988 152.381 16.4967C152.003 15.8945 151.745 15.1806 151.607 14.3548C151.521 13.8387 151.745 13.5806 152.278 13.5806H157.052C157.517 13.5806 157.844 13.6408 158.033 13.7612C158.239 13.8817 158.463 14.0537 158.704 14.2774C158.842 14.415 159.039 14.4838 159.298 14.4838C159.521 14.4838 159.71 14.4408 159.865 14.3548C160.037 14.2515 160.123 14.1053 160.123 13.9161C160.123 13.6064 159.908 13.4085 159.478 13.3225C159.065 13.2193 158.541 13.1505 157.904 13.1161C157.285 13.0645 156.605 13.0129 155.865 12.9612C155.143 12.8924 154.463 12.7548 153.827 12.5483C153.207 12.3419 152.683 12.0236 152.252 11.5935C151.84 11.1462 151.633 10.5269 151.633 9.73548C151.633 8.39356 152.252 7.38712 153.491 6.71616C154.73 6.0452 156.536 5.70972 158.91 5.70972C161.405 5.70972 163.28 6.08821 164.536 6.84519C165.809 7.60217 166.583 8.81506 166.859 10.4839C166.945 11 166.721 11.258 166.188 11.258H161.465C161.052 11.258 160.725 11.2064 160.485 11.1032C160.261 10.9828 160.029 10.8021 159.788 10.5613Z" fill={fill}/>
      <path d="M168 16.619C168 15.7932 168.249 15.1308 168.748 14.6319C169.264 14.133 169.935 13.8835 170.761 13.8835C171.587 13.8835 172.249 14.133 172.748 14.6319C173.247 15.1308 173.496 15.7932 173.496 16.619C173.496 17.4448 173.247 18.1071 172.748 18.6061C172.249 19.105 171.587 19.3544 170.761 19.3544C169.935 19.3544 169.264 19.105 168.748 18.6061C168.249 18.1071 168 17.4448 168 16.619Z" fill={dot}/>
      <path d="M147.18 18.8709C146.045 18.8709 145.107 18.7333 144.367 18.458C143.628 18.1828 143.034 17.7613 142.587 17.1935C142.157 16.6086 141.847 15.8602 141.658 14.9484C141.486 14.0366 141.4 12.9441 141.4 11.671V9.32265C141.4 8.90975 141.228 8.66029 140.884 8.57427C140.591 8.50546 140.385 8.41944 140.264 8.31621C140.161 8.19578 140.109 8.01514 140.109 7.77428V6.74204C140.109 6.26032 140.367 5.98506 140.884 5.91624C141.623 5.79581 142.182 5.46894 142.561 4.93561C142.957 4.38508 143.189 3.52487 143.258 2.35499C143.292 1.83887 143.559 1.58081 144.058 1.58081H147.851C148.367 1.58081 148.625 1.83887 148.625 2.35499V5.19367C148.625 5.70979 148.883 5.96785 149.4 5.96785H150.354C150.871 5.96785 151.129 6.22591 151.129 6.74204V7.77428C151.129 8.29041 150.871 8.54847 150.354 8.54847H149.4C148.883 8.54847 148.625 8.80653 148.625 9.32265V12.1613C148.625 12.4882 148.634 12.7549 148.651 12.9613C148.686 13.1678 148.746 13.3312 148.832 13.4516C148.935 13.5549 149.073 13.6237 149.245 13.6581C149.434 13.6925 149.683 13.7097 149.993 13.7097H150.354C150.871 13.7097 151.129 13.9678 151.129 14.4839V18.0967C151.129 18.6129 150.871 18.8709 150.354 18.8709H147.18Z" fill={fill}/>
      <path d="M130.699 7.87743C130.733 8.18711 130.879 8.34194 131.137 8.34194C131.292 8.34194 131.404 8.30754 131.473 8.23872C131.559 8.1527 131.636 8.04947 131.705 7.92905C132.066 7.34411 132.565 6.82798 133.202 6.38068C133.838 5.93337 134.673 5.70972 135.705 5.70972C136.548 5.70972 137.245 5.82154 137.795 6.0452C138.363 6.25165 138.81 6.54412 139.137 6.92261C139.464 7.28389 139.696 7.7226 139.834 8.23872C139.972 8.73764 140.04 9.27957 140.04 9.86451V18.0967C140.04 18.6128 139.782 18.8708 139.266 18.8708H133.589C133.073 18.8708 132.815 18.6128 132.815 18.0967V11.929C132.815 11.2408 132.574 10.8968 132.092 10.8968C131.817 10.8968 131.61 11.0086 131.473 11.2322C131.335 11.4559 131.266 11.7398 131.266 12.0838V18.0967C131.266 18.6128 131.008 18.8708 130.492 18.8708H124.815C124.299 18.8708 124.041 18.6128 124.041 18.0967V6.74196C124.041 6.22584 124.299 5.96778 124.815 5.96778H129.718C130.234 5.96778 130.518 6.22584 130.569 6.74196L130.699 7.87743Z" fill={fill}/>
      <path d="M116.231 13.8128C116.437 13.486 116.669 13.3225 116.927 13.3225H122.76C123.31 13.3225 123.534 13.5806 123.431 14.0967C123.259 14.9741 122.932 15.7311 122.45 16.3677C121.985 17.0042 121.392 17.5289 120.669 17.9418C119.964 18.3375 119.164 18.6386 118.269 18.845C117.375 19.0343 116.429 19.1289 115.431 19.1289C114.312 19.1289 113.254 18.9999 112.257 18.7418C111.276 18.4666 110.416 18.0537 109.676 17.5031C108.953 16.9526 108.377 16.2558 107.947 15.4128C107.517 14.5698 107.302 13.572 107.302 12.4193C107.302 11.2666 107.508 10.2688 107.921 9.4258C108.334 8.5828 108.893 7.88604 109.599 7.3355C110.321 6.78497 111.155 6.38068 112.102 6.12262C113.065 5.84735 114.089 5.70972 115.173 5.70972C116.205 5.70972 117.177 5.83015 118.089 6.071C119.001 6.29466 119.801 6.65594 120.489 7.15486C121.194 7.65378 121.77 8.29893 122.218 9.09032C122.665 9.86451 122.932 10.8021 123.018 11.9032C123.069 12.4193 122.82 12.6774 122.269 12.6774H115.173C114.897 12.6774 114.7 12.7462 114.579 12.8838C114.459 13.0215 114.441 13.2107 114.527 13.4516C114.7 13.9677 115.001 14.2257 115.431 14.2257C115.792 14.2257 116.059 14.0881 116.231 13.8128ZM115.457 10.0968C115.198 10.0968 115.001 10.1742 114.863 10.329C114.725 10.4666 114.657 10.6301 114.657 10.8193C114.657 10.9742 114.708 11.1118 114.811 11.2322C114.932 11.3355 115.138 11.3871 115.431 11.3871C115.723 11.3871 115.93 11.3355 116.05 11.2322C116.17 11.1118 116.231 10.9742 116.231 10.8193C116.231 10.6129 116.17 10.4408 116.05 10.3032C115.947 10.1656 115.749 10.0968 115.457 10.0968Z" fill={fill}/>
      <path d="M98.99 12.9998C99.0072 13.1374 99.0416 13.2578 99.0932 13.3611C99.1449 13.4471 99.2481 13.4901 99.4029 13.4901C99.5577 13.4901 99.661 13.4471 99.7126 13.3611C99.7642 13.2578 99.7986 13.1374 99.8158 12.9998L100.255 6.4192C100.289 5.90308 100.564 5.64502 101.08 5.64502H107.042C107.558 5.64502 107.764 5.89448 107.661 6.3934L105.209 17.7997C105.106 18.2986 104.796 18.5481 104.28 18.5481H94.5256C94.0094 18.5481 93.6998 18.2986 93.5965 17.7997L91.1449 6.3934C91.0417 5.89448 91.2482 5.64502 91.7643 5.64502H97.7255C98.2588 5.64502 98.5341 5.90308 98.5513 6.4192L98.99 12.9998Z" fill={fill}/>
      <path d="M89.9471 7.91602C90.4116 8.12247 90.6439 8.48375 90.6439 8.99988L90.6439 9.69664C90.6439 10.2128 90.4116 10.5741 89.9471 10.7805L82.1472 13.316C81.9924 13.3848 81.8633 13.4708 81.7601 13.574C81.6397 13.6772 81.5795 13.8493 81.5795 14.0901C81.5795 14.2622 81.6397 14.3826 81.7601 14.4514C81.8806 14.503 82.0268 14.5202 82.1988 14.503L89.8697 13.3869C90.3858 13.3353 90.6439 13.5676 90.6439 14.0837L90.6439 17.9223C90.6439 18.4385 90.3858 18.6965 89.8697 18.6965L73.3538 18.6965C72.8377 18.6965 72.5796 18.4385 72.5796 17.9223L72.5796 13.7482C72.5796 13.2665 72.8032 12.8794 73.2505 12.5869L77.8763 10.1095C78.0139 10.0235 78.1344 9.9289 78.2376 9.82567C78.3236 9.70525 78.3666 9.54181 78.3666 9.33536C78.3666 9.12891 78.3236 8.97407 78.2376 8.87085C78.1344 8.75042 78.0139 8.64719 77.8763 8.56117L73.2505 6.10959C72.8032 5.81712 72.5796 5.43003 72.5796 4.94831L72.5796 0.774172C72.5796 0.258049 72.8377 -1.33627e-05 73.3538 -1.33853e-05L89.8697 -1.41072e-05C90.3858 -1.41298e-05 90.6439 0.258048 90.6439 0.774171L90.6439 4.61283C90.6439 5.12896 90.3858 5.36121 89.8697 5.3096L82.1988 4.19348C82.0268 4.17628 81.8806 4.19348 81.7601 4.2451C81.6397 4.29671 81.5795 4.41714 81.5795 4.60638C81.5795 4.83003 81.6397 5.00208 81.7601 5.1225C81.8633 5.22573 81.9924 5.31175 82.1472 5.38057L89.9471 7.91602Z" fill={fill}/>
      <path d="M64.8525 17.026C64.8352 16.8884 64.7922 16.7766 64.7234 16.6905C64.6718 16.6045 64.5686 16.5615 64.4137 16.5615C64.2589 16.5615 64.1385 16.6045 64.0525 16.6905C63.9836 16.7594 63.9148 16.854 63.846 16.9744C63.5191 17.5421 63.1234 17.9895 62.6589 18.3163C62.1944 18.6432 61.5063 18.8066 60.5944 18.8066C58.9428 18.8066 57.6181 18.2475 56.6203 17.1292C55.6225 15.9938 55.1235 14.3078 55.1235 12.0712C55.1235 10.9186 55.2526 9.92073 55.5106 9.07773C55.7687 8.23473 56.13 7.54657 56.5945 7.01324C57.0762 6.46271 57.6525 6.05841 58.3235 5.80035C58.9945 5.52508 59.7342 5.38745 60.5428 5.38745C61.2138 5.38745 61.7987 5.50788 62.2976 5.74874C62.7966 5.9896 63.2353 6.30787 63.6138 6.70357C63.6998 6.80679 63.7858 6.867 63.8718 6.88421C63.9578 6.90141 64.0267 6.90141 64.0783 6.88421C64.1299 6.867 64.1729 6.8412 64.2073 6.80679C64.2589 6.75518 64.2847 6.66055 64.2847 6.52292V6.4197C64.2847 5.90358 64.5428 5.64551 65.0589 5.64551H70.7362C71.2524 5.64551 71.5104 5.90358 71.5104 6.4197V17.7744C71.5104 18.2905 71.2524 18.5486 70.7362 18.5486H65.8331C65.3342 18.5486 65.0417 18.2905 64.9557 17.7744L64.8525 17.026ZM63.3557 13.6196C63.6482 13.6196 63.8718 13.5078 64.0267 13.2841C64.1987 13.0605 64.2847 12.7766 64.2847 12.4325V11.7616C64.2847 11.4175 64.1987 11.1336 64.0267 10.91C63.8718 10.6863 63.6482 10.5745 63.3557 10.5745C62.7708 10.5745 62.4783 11.082 62.4783 12.097C62.4783 12.5788 62.5471 12.9573 62.6847 13.2325C62.8224 13.4906 63.046 13.6196 63.3557 13.6196Z" fill={fill}/>
      <path d="M45.2353 19.8389C45.8891 19.8389 46.3622 19.6668 46.6547 19.3228C46.9643 18.9959 47.1192 18.4454 47.1192 17.6712C47.1192 17.5163 47.0934 17.4217 47.0418 17.3873C47.0074 17.3357 46.9643 17.3013 46.9127 17.2841C46.8611 17.2669 46.7923 17.2755 46.7063 17.3099C46.6203 17.3271 46.5342 17.3873 46.4482 17.4905C46.0697 17.8862 45.631 18.2045 45.1321 18.4454C44.6332 18.6862 44.0483 18.8066 43.3773 18.8066C42.5687 18.8066 41.8289 18.6776 41.158 18.4196C40.487 18.1443 39.9107 17.74 39.429 17.2067C38.9644 16.6561 38.6032 15.9594 38.3451 15.1164C38.087 14.2734 37.958 13.2755 37.958 12.1229C37.958 9.86912 38.4569 8.18312 39.4548 7.06485C40.4526 5.94658 41.7773 5.38745 43.4289 5.38745C44.3407 5.38745 45.0289 5.55089 45.4934 5.87777C45.9579 6.20465 46.3536 6.65195 46.6805 7.21969C46.7493 7.34012 46.8181 7.44334 46.8869 7.52936C46.9729 7.59818 47.0934 7.63259 47.2482 7.63259C47.4031 7.63259 47.5063 7.58958 47.5579 7.50355C47.6267 7.41753 47.6697 7.30571 47.6869 7.16808L47.7901 6.4197C47.8762 5.90357 48.1686 5.64551 48.6676 5.64551H53.5707C54.0868 5.64551 54.3449 5.90357 54.3449 6.4197V18.0067C54.3449 19.2626 54.2073 20.3292 53.932 21.2066C53.6567 22.1012 53.2266 22.8238 52.6417 23.3743C52.0568 23.9421 51.2998 24.355 50.3708 24.613C49.4589 24.8711 48.3579 25.0001 47.0676 25.0001H40.487C39.9709 25.0001 39.7128 24.7421 39.7128 24.2259V20.6131C39.7128 20.097 39.9709 19.8389 40.487 19.8389H45.2353ZM46.1902 10.5745C45.8805 10.5745 45.6568 10.7121 45.5192 10.9874C45.3816 11.2454 45.3128 11.6153 45.3128 12.097C45.3128 13.1121 45.6052 13.6196 46.1902 13.6196C46.4826 13.6196 46.7063 13.5078 46.8611 13.2841C47.0332 13.0605 47.1192 12.7766 47.1192 12.4325V11.7616C47.1192 11.4175 47.0332 11.1336 46.8611 10.91C46.7063 10.6863 46.4826 10.5745 46.1902 10.5745Z" fill={fill}/>
      <path d="M29.8894 13.8128C30.0958 13.486 30.3281 13.3225 30.5861 13.3225H36.4183C36.9689 13.3225 37.1925 13.5806 37.0893 14.0967C36.9172 14.9741 36.5904 15.7311 36.1087 16.3677C35.6441 17.0042 35.0506 17.5289 34.328 17.9418C33.6227 18.3375 32.8227 18.6386 31.9281 18.845C31.0334 19.0343 30.0872 19.1289 29.0894 19.1289C27.9711 19.1289 26.9131 18.9999 25.9152 18.7418C24.9346 18.4666 24.0744 18.0537 23.3346 17.5031C22.612 16.9526 22.0357 16.2558 21.6056 15.4128C21.1755 14.5698 20.9604 13.572 20.9604 12.4193C20.9604 11.2666 21.1669 10.2688 21.5798 9.4258C21.9927 8.5828 22.5518 7.88604 23.2572 7.3355C23.9798 6.78497 24.8142 6.38068 25.7604 6.12262C26.7238 5.84735 27.7475 5.70972 28.8313 5.70972C29.8636 5.70972 30.8356 5.83015 31.7474 6.071C32.6592 6.29466 33.4592 6.65594 34.1474 7.15486C34.8528 7.65378 35.4291 8.29893 35.8764 9.09032C36.3237 9.86451 36.5904 10.8021 36.6764 11.9032C36.728 12.4193 36.4785 12.6774 35.928 12.6774H28.8313C28.5561 12.6774 28.3582 12.7462 28.2378 12.8838C28.1174 13.0215 28.1001 13.2107 28.1862 13.4516C28.3582 13.9677 28.6593 14.2257 29.0894 14.2257C29.4507 14.2257 29.7173 14.0881 29.8894 13.8128ZM29.1152 10.0968C28.8571 10.0968 28.6593 10.1742 28.5216 10.329C28.384 10.4666 28.3152 10.6301 28.3152 10.8193C28.3152 10.9742 28.3668 11.1118 28.47 11.2322C28.5905 11.3355 28.7969 11.3871 29.0894 11.3871C29.3819 11.3871 29.5883 11.3355 29.7087 11.2322C29.8292 11.1118 29.8894 10.9742 29.8894 10.8193C29.8894 10.6129 29.8292 10.4408 29.7087 10.3032C29.6055 10.1656 29.4077 10.0968 29.1152 10.0968Z" fill={fill}/>
      <path d="M11.587 18.174C11.3805 18.6385 11.0192 18.8707 10.5031 18.8707H9.80633C9.29021 18.8707 8.92892 18.6385 8.72247 18.174L6.18702 9.56763C6.1182 9.41279 6.03218 9.28376 5.92896 9.18053C5.82573 9.06011 5.65369 8.99989 5.41284 8.99989C5.2408 8.99989 5.12037 9.06011 5.05155 9.18053C4.99994 9.30096 4.98273 9.4472 4.99994 9.61924L6.11605 18.0966C6.16767 18.6127 5.93541 18.8707 5.41929 18.8707H0.774184C0.258061 18.8707 0 18.6127 0 18.0966V0.774185C0 0.258062 0.258061 0 0.774184 0H5.75477C6.23648 0 6.62357 0.223653 6.91604 0.67096L9.39343 4.49027C9.47945 4.6279 9.57408 4.74833 9.6773 4.85155C9.79773 4.93757 9.96117 4.98059 10.1676 4.98059C10.3741 4.98059 10.5289 4.93757 10.6321 4.85155C10.7526 4.74833 10.8558 4.6279 10.9418 4.49027L13.3934 0.67096C13.6859 0.223653 14.0729 0 14.5547 0H19.5352C20.0514 0 20.3094 0.258062 20.3094 0.774185V18.0966C20.3094 18.6127 20.0514 18.8707 19.5352 18.8707H14.8901C14.374 18.8707 14.1418 18.6127 14.1934 18.0966L15.3095 9.61924C15.3267 9.4472 15.3095 9.30096 15.2579 9.18053C15.2063 9.06011 15.0858 8.99989 14.8966 8.99989C14.6729 8.99989 14.5009 9.06011 14.3805 9.18053C14.2772 9.28376 14.1912 9.41279 14.1224 9.56763L11.587 18.174Z" fill={fill}/>
    </svg>
  );
}

// Fake-barcode strip (thin dark bars, varying widths - deterministic).
function Barcode({ width, height, color }: { width: number; height: number; color: string }) {
  const bars: React.ReactElement[] = [];
  let x = 0;
  let i = 0;
  while (x < width - 8) {
    const bw = [3, 6, 2, 8, 4, 2, 5][i % 7];
    const gap = [4, 3, 6, 3, 5, 4, 3][(i + 3) % 7];
    bars.push(
      <div key={i} style={{ display: "flex", position: "absolute", left: x, top: 0, width: bw, height, backgroundColor: color }} />
    );
    x += bw + gap;
    i++;
  }
  return <div style={{ display: "flex", position: "relative", width, height }}>{bars}</div>;
}

type Concept = { file: string; node: React.ReactElement };

const CONCEPTS: Concept[] = [
  // F. TICKET - the creative IS a ticket/boarding pass. Light card on dark.
  {
    file: "F-ticket",
    node: (
      <div style={{ width: W, height: H, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: CANVAS, fontFamily: "brand", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, background: `radial-gradient(700px 600px at 20% 15%, ${AQUA}2E, transparent 70%)`, display: "flex" }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, background: `radial-gradient(700px 600px at 85% 90%, ${MINT}2E, transparent 70%)`, display: "flex" }} />
        {/* the ticket */}
        <div style={{ display: "flex", flexDirection: "column", width: 930, height: 990, borderRadius: 44, backgroundColor: INK, overflow: "hidden", position: "relative", boxShadow: "0 40px 120px rgba(0,0,0,0.6)" }}>
          {/* photo half */}
          <div style={{ display: "flex", width: 930, height: 470, overflow: "hidden", position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PHOTO} width={930} height={700} alt="" style={{ width: 930, height: 700, objectFit: "cover", marginTop: 0 }} />
            <div style={{ position: "absolute", left: 0, top: 0, display: "flex", padding: "22px 30px" }}>
              <Wordmark width={210} fill={INK} />
            </div>
          </div>
          {/* perforation */}
          <div style={{ display: "flex", position: "relative", height: 0, borderTop: "5px dashed rgba(7,6,24,0.22)" }} />
          <div style={{ display: "flex", position: "absolute", left: -30, top: 442, width: 56, height: 56, borderRadius: 999, backgroundColor: CANVAS }} />
          <div style={{ display: "flex", position: "absolute", right: -30, top: 442, width: 56, height: 56, borderRadius: 999, backgroundColor: CANVAS }} />
          {/* details half - DARK text on light */}
          <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "flex-end", padding: "34px 44px 28px", color: CANVAS }}>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{bidiVisual(NAME)}</div>
            <div style={{ display: "flex", marginTop: 18, gap: 40, flexDirection: "row-reverse" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ display: "flex", fontSize: 22, color: "rgba(7,6,24,0.5)" }}>{bidiVisual("תאריך")}</div>
                <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{DATE}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ display: "flex", fontSize: 22, color: "rgba(7,6,24,0.5)" }}>{bidiVisual("מיקום")}</div>
                <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{bidiVisual(LOC)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ display: "flex", fontSize: 22, color: "rgba(7,6,24,0.5)" }}>{bidiVisual("החבילה כוללת")}</div>
                <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{bidiVisual("טיסה + מלון + כרטיס")}</div>
              </div>
            </div>
            <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", marginTop: 30 }}>
              <Barcode width={300} height={74} color="rgba(7,6,24,0.85)" />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 40px", borderRadius: 24, backgroundColor: CANVAS }}>
                <div style={{ display: "flex", fontSize: 22, color: "rgba(250,250,245,0.75)", fontWeight: 700 }}>
                  {bidiVisual("מחיר ממוצע לנוסע")}
                </div>
                <div style={{ display: "flex", fontSize: 54, color: MINT, fontWeight: 700 }}>$1,953</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  },

  // G. EDITORIAL - asymmetric magazine poster, photo left-bleed, type column right.
  {
    file: "G-editorial",
    node: (
      <div style={{ width: W, height: H, display: "flex", backgroundColor: CANVAS, fontFamily: "brand", color: INK, position: "relative", overflow: "hidden" }}>
        {/* photo bleeding off the LEFT half */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTO2} width={640} height={1080} alt="" style={{ position: "absolute", left: -60, top: 0, width: 640, height: 1080, objectFit: "cover" }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, background: `linear-gradient(90deg, ${CANVAS}00 22%, ${CANVAS}D9 46%, ${CANVAS} 60%)`, display: "flex" }} />
        {/* type column on the right */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", position: "absolute", right: 64, top: 0, height: H, width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, color: MINT, fontWeight: 700 }}>
            <div style={{ display: "flex" }}>{DATE}</div>
            <div style={{ display: "flex", width: 8, height: 8, borderRadius: 999, backgroundColor: MINT }} />
            <div style={{ display: "flex" }}>{bidiVisual(LOC)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 18, lineHeight: 0.98 }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700 }}>{bidiVisual("אריאנה")}</div>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700, color: MINT }}>{bidiVisual("גרנדה")}</div>
          </div>
          <div style={{ display: "flex", width: 340, height: 3, backgroundColor: "rgba(250,250,245,0.25)", marginTop: 34, marginBottom: 26 }} />
          <div style={{ display: "flex", fontSize: 34, color: "rgba(250,250,245,0.85)" }}>{bidiVisual("טיסה + מלון + כרטיס רשמי")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 24, flexDirection: "row-reverse" }}>
            <div style={{ display: "flex", fontSize: 34, color: "rgba(250,250,245,0.65)" }}>{bidiVisual("מחיר ממוצע לנוסע")}</div>
            <div style={{ display: "flex", fontSize: 92, fontWeight: 700, color: MINT }}>$1,953</div>
          </div>
          <div style={{ display: "flex", marginTop: 46 }}>
            <Wordmark width={240} />
          </div>
        </div>
      </div>
    ),
  },

  // H. COLOR-BLOCK - photo left, solid mint block right, dark text on mint.
  {
    file: "H-color-block",
    node: (
      <div style={{ width: W, height: H, display: "flex", backgroundColor: CANVAS, fontFamily: "brand", position: "relative", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTO} width={620} height={1080} alt="" style={{ position: "absolute", left: 0, top: 0, width: 620, height: 1080, objectFit: "cover" }} />
        {/* angled mint block */}
        <div style={{ display: "flex", position: "absolute", left: 560, top: -80, width: 640, height: 1240, backgroundColor: MINT, transform: "rotate(6deg)" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", position: "absolute", right: 48, top: 0, height: H, width: 430, color: CANVAS }}>
          <Wordmark width={230} fill={CANVAS} dot={CANVAS} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 40, lineHeight: 1.02 }}>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 700 }}>{bidiVisual("אריאנה")}</div>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 700 }}>{bidiVisual("גרנדה")}</div>
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, marginTop: 26 }}>{bidiVisual(`${DATE} · ${CITY}`)}</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 26, gap: 8, fontSize: 30 }}>
            <div style={{ display: "flex" }}>{bidiVisual("טיסה הלוך-חזור")}</div>
            <div style={{ display: "flex" }}>{bidiVisual("3 לילות מלון")}</div>
            <div style={{ display: "flex" }}>{bidiVisual("כרטיס רשמי להופעה")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 34, padding: "12px 44px", borderRadius: 22, backgroundColor: CANVAS }}>
            <div style={{ display: "flex", fontSize: 24, color: "rgba(250,250,245,0.75)", fontWeight: 700 }}>
              {bidiVisual("מחיר ממוצע לנוסע")}
            </div>
            <div style={{ display: "flex", fontSize: 60, color: MINT, fontWeight: 700 }}>$1,953</div>
          </div>
        </div>
      </div>
    ),
  },

  // I. PHOTO STACK - gallery prints scattered like polaroids.
  {
    file: "I-photo-stack",
    node: (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", backgroundColor: CANVAS, fontFamily: "brand", color: INK, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, background: `radial-gradient(620px 560px at 50% 40%, ${MINT}26, transparent 70%)`, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 40, position: "relative" }}>
          <Wordmark width={280} />
        </div>
        {/* the stack */}
        <div style={{ display: "flex", flex: 1, position: "relative" }}>
          <div style={{ display: "flex", position: "absolute", left: 96, top: 100, transform: "rotate(-10deg)", backgroundColor: INK, padding: 16, paddingBottom: 54, boxShadow: "0 24px 70px rgba(0,0,0,0.55)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PHOTO2} width={330} height={390} alt="" style={{ width: 330, height: 390, objectFit: "cover" }} />
          </div>
          <div style={{ display: "flex", position: "absolute", right: 82, top: 66, transform: "rotate(8deg)", backgroundColor: INK, padding: 16, paddingBottom: 54, boxShadow: "0 24px 70px rgba(0,0,0,0.55)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CUTOUT} width={320} height={380} alt="" style={{ width: 320, height: 380, objectFit: "cover", backgroundColor: "#0D0C1E" }} />
          </div>
          <div style={{ display: "flex", position: "absolute", left: 300, top: 28, transform: "rotate(-2deg)", backgroundColor: INK, padding: 18, paddingBottom: 60, boxShadow: "0 34px 90px rgba(0,0,0,0.65)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PHOTO} width={440} height={470} alt="" style={{ width: 440, height: 470, objectFit: "cover" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 46, position: "relative" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, textShadow: "0 4px 24px rgba(0,0,0,0.7)" }}>{bidiVisual(NAME)}</div>
          <div style={{ display: "flex", fontSize: 34, color: "rgba(250,250,245,0.85)", marginTop: 12 }}>{bidiVisual(`${DATE} · ${LOC}`)}</div>
          <div style={{ display: "flex", marginTop: 18, padding: "14px 44px", borderRadius: 999, backgroundColor: MINT, color: CANVAS, fontSize: 44, fontWeight: 700, boxShadow: `0 0 60px ${MINT}55` }}>
            {bidiVisual("מחיר ממוצע לנוסע $1,953")}
          </div>
        </div>
      </div>
    ),
  },

  // J. BOTTOM BAR - photo full-bleed, one solid mint info bar. Minimal.
  {
    file: "J-bottom-bar",
    node: (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", backgroundColor: CANVAS, fontFamily: "brand", position: "relative", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTO} width={W} height={1160} alt="" style={{ position: "absolute", left: 0, top: 0, width: W, height: 1160, objectFit: "cover" }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: 240, background: `linear-gradient(180deg, ${CANVAS}CC 0%, ${CANVAS}00 100%)`, display: "flex" }} />
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 36, position: "relative" }}>
          <Wordmark width={260} />
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        {/* name floated just above the bar */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", paddingRight: 56, paddingBottom: 24, position: "relative" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1.02, textShadow: "0 6px 30px rgba(0,0,0,0.9)" }}>{bidiVisual(NAME)}</div>
          <div style={{ display: "flex", fontSize: 36, color: INK, marginTop: 10, textShadow: "0 4px 20px rgba(0,0,0,0.9)" }}>{bidiVisual(`${DATE} · ${LOC}`)}</div>
        </div>
        {/* the mint bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 150, backgroundColor: MINT, color: CANVAS, padding: "0 56px", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, opacity: 0.75 }}>{bidiVisual("מחיר ממוצע לנוסע")}</div>
            <div style={{ display: "flex", fontSize: 66, fontWeight: 700 }}>$1,953</div>
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>{bidiVisual("טיסה + מלון + כרטיס רשמי")}</div>
        </div>
      </div>
    ),
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const fontRes = await fetch(FONT_URL);
  if (!fontRes.ok) throw new Error(`font fetch ${fontRes.status}`);
  const font = await fontRes.arrayBuffer();
  for (const c of CONCEPTS) {
    const image = new ImageResponse(c.node, {
      width: W,
      height: H,
      fonts: [{ name: "brand", data: font, style: "normal", weight: 700 }],
    });
    const buf = Buffer.from(await image.arrayBuffer());
    writeFileSync(`${OUT}/${c.file}.png`, buf);
    console.log(`rendered ${c.file}.png (${buf.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
