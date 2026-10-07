import Image from "next/image";

export function WorkshopBackdrop() {
  return (
    <div className="workshop-wallpaper" aria-hidden="true">
      <Image
        src="/art/midnight-workshop-crisp.png"
        alt=""
        fill
        priority
        // A 3:2 image covering a tall viewport is sized by height, not width.
        sizes="max(100vw, 150vh)"
        quality={95}
      />
      <div className="wallpaper-wash" />
    </div>
  );
}
