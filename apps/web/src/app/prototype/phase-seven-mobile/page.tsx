import { PhaseSevenMobilePrototype } from "./phase-seven-mobile-prototype";

export const metadata = {
  title: "Phase Seven mobile shell prototype · Tendnote",
};

export default async function PhaseSevenMobilePrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const requestedVariant = (await searchParams).variant;
  const initialVariant =
    requestedVariant === "A" || requestedVariant === "B" || requestedVariant === "C"
      ? requestedVariant
      : "S";

  return <PhaseSevenMobilePrototype initialVariant={initialVariant} />;
}
