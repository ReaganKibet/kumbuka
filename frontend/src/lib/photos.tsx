// Free-licence photos (unsplash.com/license), served from Unsplash's image CDN with credit below.
export const PHOTO = {
  session: { id: "photo-1739287088634-dead4eb7cfc6", by: "Ninthgrid", user: "ninthgrid_", alt: "A counsellor and a young woman talking in a counselling session, each holding notes" },
  group: { id: "photo-1694286067026-a8aa654481f7", by: "Michael Ali", user: "michaeljfali", alt: "A woman facilitating a community meeting under a shelter, with people seated around her" },
  school: { id: "photo-1761604478724-13fe879468cf", by: "Rewired Digital", user: "rewired41", alt: "A teacher guiding young children through a drawing activity in a classroom in Kampala" },
  peers: { id: "photo-1655720357740-bdf90f34483f", by: "Iwaria Inc.", user: "iwaria", alt: "Three women sitting together on a sofa, talking over cups of tea" },
  family: { id: "photo-1724453796952-f7df6d7e289a", by: "Dwayne Joe", user: "spliff_dj_joe", alt: "A young woman holding a child close in a warm embrace" },
  hands: { id: "photo-1655720359248-eeace8c709c5", by: "Iwaria Inc.", user: "iwaria", alt: "" },
} as const;
export type PhotoKey = keyof typeof PHOTO;

const src = (k: PhotoKey, w: number) => `https://images.unsplash.com/${PHOTO[k].id}?auto=format&fit=crop&w=${w}&q=70`;

export function Photo({ k, className = "", sizes = "(min-width: 768px) 50vw, 100vw", eager = false }: { k: PhotoKey; className?: string; sizes?: string; eager?: boolean }) {
  return (
    <img
      src={src(k, 1080)}
      srcSet={[640, 1080, 1600].map((w) => `${src(k, w)} ${w}w`).join(", ")}
      sizes={sizes}
      alt={PHOTO[k].alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
