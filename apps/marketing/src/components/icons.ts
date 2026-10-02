/**
 * The marketing site's icons, from Phosphor like the product's
 * (`apps/web/src/components/icons.ts`), so both draw the same glyphs at the
 * same `regular` weight. Call sites import from here, never from the vendor,
 * and pass `aria-hidden` unless the icon is the only thing naming a control.
 */

export {
  ArrowCounterClockwiseIcon as RestartIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
