import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** The standard shadcn/ui class-merging helper: clsx for conditionals, tailwind-merge to resolve
 *  conflicting Tailwind utility classes (e.g. two different `px-*` values) in favour of the last. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
