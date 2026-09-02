"use client";

/**
 * AI Elements Inline Citation (https://elements.ai-sdk.dev/components/inline-citation).
 *
 * Local modifications, per the branch's registry rule:
 * - `lucide-react` icons rerouted to `@/components/icons`.
 * - `InlineCitationCardTrigger` renders `children` when given, falling back to
 *   upstream's hostname badge. Tendnote's citation marker is the source's
 *   number, set in mono (DESIGN.md §4: mono for machine facts), not a
 *   hostname - the host is already on the card. Upstream writes its label as
 *   JSX children of the `Badge`, which silently wins over anything a caller
 *   spreads in, so the label could not be replaced from the call site. The
 *   `children ?? …` shape is the one the rest of the registry already uses
 *   (`SourcesTrigger`, `Source`).
 * - biome format.
 *
 * The carousel half (`InlineCitationCarousel*`) is unused here: a Tendnote
 * citation cites exactly one source, so the card body holds one source and
 * needs no paging. It is kept because the file is redistributed whole.
 */

import type { ComponentProps } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import type { CarouselApi } from "@/components/ui/carousel";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({ className, ...props }: InlineCitationProps) => (
  <span className={cn("group inline items-center gap-1", className)} {...props} />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({ className, ...props }: InlineCitationTextProps) => (
  <span className={cn("transition-colors group-hover:bg-accent", className)} {...props} />
);

export type InlineCitationCardProps = ComponentProps<typeof HoverCard>;

export const InlineCitationCard = (props: InlineCitationCardProps) => (
  <HoverCard closeDelay={0} openDelay={0} {...props} />
);

export type InlineCitationCardTriggerProps = ComponentProps<typeof Badge> & {
  sources: string[];
};

export const InlineCitationCardTrigger = ({
  sources,
  className,
  children,
  ...props
}: InlineCitationCardTriggerProps) => (
  <HoverCardTrigger asChild>
    <Badge className={cn("ml-1 rounded-full", className)} variant="secondary" {...props}>
      {children ??
        (sources[0] ? (
          <>
            {new URL(sources[0]).hostname} {sources.length > 1 && `+${sources.length - 1}`}
          </>
        ) : (
          "unknown"
        ))}
    </Badge>
  </HoverCardTrigger>
);

export type InlineCitationCardBodyProps = ComponentProps<"div">;

export const InlineCitationCardBody = ({ className, ...props }: InlineCitationCardBodyProps) => (
  <HoverCardContent className={cn("relative w-80 p-0", className)} {...props} />
);

const CarouselApiContext = createContext<CarouselApi | undefined>(undefined);

const useCarouselApi = () => {
  const context = useContext(CarouselApiContext);
  return context;
};

export type InlineCitationCarouselProps = ComponentProps<typeof Carousel>;

export const InlineCitationCarousel = ({
  className,
  children,
  ...props
}: InlineCitationCarouselProps) => {
  const [api, setApi] = useState<CarouselApi>();

  return (
    <CarouselApiContext.Provider value={api}>
      <Carousel className={cn("w-full", className)} setApi={setApi} {...props}>
        {children}
      </Carousel>
    </CarouselApiContext.Provider>
  );
};

export type InlineCitationCarouselContentProps = ComponentProps<"div">;

export const InlineCitationCarouselContent = (props: InlineCitationCarouselContentProps) => (
  <CarouselContent {...props} />
);

export type InlineCitationCarouselItemProps = ComponentProps<"div">;

export const InlineCitationCarouselItem = ({
  className,
  ...props
}: InlineCitationCarouselItemProps) => (
  <CarouselItem className={cn("w-full space-y-2 p-4 pl-8", className)} {...props} />
);

export type InlineCitationCarouselHeaderProps = ComponentProps<"div">;

export const InlineCitationCarouselHeader = ({
  className,
  ...props
}: InlineCitationCarouselHeaderProps) => (
  <div
    className={cn(
      "flex items-center justify-between gap-2 rounded-t-md bg-secondary p-2",
      className,
    )}
    {...props}
  />
);

export type InlineCitationCarouselIndexProps = ComponentProps<"div">;

export const InlineCitationCarouselIndex = ({
  children,
  className,
  ...props
}: InlineCitationCarouselIndexProps) => {
  const api = useCarouselApi();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  const syncState = useCallback(() => {
    if (!api) {
      return;
    }
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);
  }, [api]);

  useEffect(() => {
    if (!api) {
      return;
    }

    syncState();

    api.on("select", syncState);

    return () => {
      api.off("select", syncState);
    };
  }, [api, syncState]);

  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-end px-3 py-1 text-muted-foreground text-xs",
        className,
      )}
      {...props}
    >
      {children ?? `${current}/${count}`}
    </div>
  );
};

export type InlineCitationCarouselPrevProps = ComponentProps<"button">;

export const InlineCitationCarouselPrev = ({
  className,
  ...props
}: InlineCitationCarouselPrevProps) => {
  const api = useCarouselApi();

  const handleClick = useCallback(() => {
    if (api) {
      api.scrollPrev();
    }
  }, [api]);

  return (
    <button
      aria-label="Previous"
      className={cn("shrink-0", className)}
      onClick={handleClick}
      type="button"
      {...props}
    >
      <ArrowLeftIcon className="size-4 text-muted-foreground" />
    </button>
  );
};

export type InlineCitationCarouselNextProps = ComponentProps<"button">;

export const InlineCitationCarouselNext = ({
  className,
  ...props
}: InlineCitationCarouselNextProps) => {
  const api = useCarouselApi();

  const handleClick = useCallback(() => {
    if (api) {
      api.scrollNext();
    }
  }, [api]);

  return (
    <button
      aria-label="Next"
      className={cn("shrink-0", className)}
      onClick={handleClick}
      type="button"
      {...props}
    >
      <ArrowRightIcon className="size-4 text-muted-foreground" />
    </button>
  );
};

export type InlineCitationSourceProps = ComponentProps<"div"> & {
  title?: string;
  url?: string;
  description?: string;
};

export const InlineCitationSource = ({
  title,
  url,
  description,
  className,
  children,
  ...props
}: InlineCitationSourceProps) => (
  <div className={cn("space-y-1", className)} {...props}>
    {title && <h4 className="truncate font-medium text-sm leading-tight">{title}</h4>}
    {url && <p className="truncate break-all text-muted-foreground text-xs">{url}</p>}
    {description && (
      <p className="line-clamp-3 text-muted-foreground text-sm leading-relaxed">{description}</p>
    )}
    {children}
  </div>
);

export type InlineCitationQuoteProps = ComponentProps<"blockquote">;

export const InlineCitationQuote = ({
  children,
  className,
  ...props
}: InlineCitationQuoteProps) => (
  <blockquote
    className={cn("border-muted border-l-2 pl-3 text-muted-foreground text-sm italic", className)}
    {...props}
  >
    {children}
  </blockquote>
);
