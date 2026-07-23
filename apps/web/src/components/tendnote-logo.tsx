import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The selected Tended Memory raster, kept exact rather than redrawn. Light and
 * dark exports share one alpha silhouette; only their palette changes.
 */
export function TendnoteMark({ className, label }: { className?: string; label?: string }) {
  const images = (
    <>
      <Image
        alt=""
        aria-hidden
        className="size-full object-contain dark:hidden"
        height={256}
        loading="eager"
        src="/icons/tendnote-mark-light.png"
        unoptimized
        width={256}
      />
      <Image
        alt=""
        aria-hidden
        className="hidden size-full object-contain dark:block"
        height={256}
        loading="eager"
        src="/icons/tendnote-mark-dark.png"
        unoptimized
        width={256}
      />
    </>
  );

  if (label) {
    return (
      <span
        aria-label={label}
        className={cn("relative inline-block shrink-0", className)}
        role="img"
      >
        {images}
      </span>
    );
  }

  return (
    <span aria-hidden className={cn("relative inline-block shrink-0", className)}>
      {images}
    </span>
  );
}

export function TendnoteLogo({
  className,
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <TendnoteMark className={cn("size-8 shrink-0", markClassName)} />
      <span className={wordmarkClassName}>Tendnote</span>
    </span>
  );
}
