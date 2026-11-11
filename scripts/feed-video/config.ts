// Which artists get a feed video, and which of the three styles their pictures can carry.
// Hand-picked for the first run (Dor 11.11: the top sellers; the per-artist switch and a
// staff screen come with the full build - spec to follow). A style is listed only when the
// artist has the pictures it needs:
//   A (poster in motion)   - a cut-out;
//   B (fast Reels cuts)    - three stage photos + a cut-out;
//   C (concert atmosphere) - at least one stage photo good enough for a full-bleed frame.
// `photos` are STAGE photos only - a red-carpet shot (U2's image_url, NBC / Golden Globes
// logos behind them) is not one. `cutoutInC` = whether the cut-out is sharp enough to rise
// full height in C (it is drawn ~1000 px tall there).

export type VideoStyle = "A" | "B" | "C";

export type VideoArtist = {
  id: number; // artists.id
  feedLabel: string; // the feed's custom_label_2 for this artist
  cutout: string;
  photos: string[];
  styles: VideoStyle[];
  cutoutInC: boolean;
};

const S = "https://fandqafngybfdyslofmr.supabase.co/storage/v1/object/public";

export const VIDEO_ARTISTS: VideoArtist[] = [
  {
    id: 44,
    feedLabel: "oasis",
    cutout: `${S}/templates/shutterstock_2841971393-cutout-1790028812333.png`,
    photos: [
      `${S}/card_images/oasis%202.jpeg`,
      `${S}/card_images/oasis%201.jpeg`,
      `${S}/templates/oasis.jpg`,
    ],
    styles: ["A", "B", "C"],
    cutoutInC: true,
  },
  {
    id: 4,
    feedLabel: "celine-dion",
    cutout: `${S}/templates/celine-dion-art-tight.png`, // 317x467 - fine in A, too small for C
    photos: [`${S}/templates/migrated/2ngg9lNiKMyovNmeakhn2T.jpeg`], // on stage, 1200x1600
    styles: ["A", "C"],
    cutoutInC: false,
  },
  {
    id: 3,
    feedLabel: "olivia-rodrigo",
    cutout: `${S}/templates/olivia-rodrigo-art-tight.png`,
    photos: [`${S}/templates/migrated/3vyS5whE0AZaCnKnoShIzs.jpeg`], // on stage, 650x717
    styles: ["A", "C"],
    cutoutInC: true,
  },
  {
    id: 133,
    feedLabel: "u2",
    cutout: `${S}/templates/U2-cutout-1794134026532.png`,
    photos: [], // the only photo is a red-carpet one
    styles: ["A"],
    cutoutInC: false,
  },
];
