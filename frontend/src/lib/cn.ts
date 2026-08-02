import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Koşullu sınıfları birleştirir ve çakışan Tailwind sınıflarını
 * son yazılan kazanacak şekilde ayıklar.
 *
 *   cn("px-2 py-1", isBig && "px-6")  →  "py-1 px-6"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
