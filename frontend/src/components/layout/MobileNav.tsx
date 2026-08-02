import { NavLink } from "react-router-dom";

import { PRIMARY_NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/cn";

/** Telefonda en sık kullanılan bölümlere tek dokunuşla erişim. */
export function MobileNav() {
  return (
    <nav
      className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line lg:hidden"
      // iPhone'un alt çubuğunun altında kalmasın
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <li key={item.path} className="flex-1">
            <NavLink
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[0.65rem] font-medium transition-soft",
                  isActive ? "text-brand" : "text-subtle",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "grid size-8 place-items-center rounded-lg transition-soft",
                      isActive && "bg-brand/12",
                    )}
                  >
                    <item.icon className="size-[1.1rem]" />
                  </span>
                  <span className="max-w-full truncate px-1">{shortLabel(item.label)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Alt çubukta yer dar; iki kelimelik başlıkları kısalt. */
function shortLabel(label: string): string {
  const map: Record<string, string> = {
    "Kontrol Merkezi": "Merkez",
    "Manuel Kontrol": "Kontrol",
    "Tarla Tasarımcısı": "Tarla",
    "Sulama & Takvim": "Takvim",
  };
  return map[label] ?? label;
}
