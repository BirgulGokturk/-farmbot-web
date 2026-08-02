import { NavLink } from "react-router-dom";
import { X } from "lucide-react";

import { NAV_GROUPS } from "@/lib/navigation";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/primitives";
import { BotLogo } from "./BotLogo";
import { ConnectionPill } from "./ConnectionPill";

interface SidebarProps {
  /** Mobilde çekmece açık mı */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobil çekmece arka planı */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-bg-elevated",
          "transition-transform duration-300 ease-[var(--ease-out-soft)]",
          // Masaüstünde her zaman görünür, mobilde kaydırarak açılır
          "lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <BotLogo />
          <IconButton label="Menüyü kapat" size="sm" onClick={onClose} className="lg:hidden">
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="px-5 pb-4">
          <ConnectionPill />
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5",
                          "text-sm font-medium transition-soft",
                          isActive
                            ? "bg-brand/10 text-brand"
                            : "text-muted hover:bg-surface-2 hover:text-content",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/* Aktif bölüm göstergesi */}
                          <span
                            className={cn(
                              "absolute left-0 h-5 w-1 rounded-r-full bg-gradient-brand transition-all",
                              isActive ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <item.icon className="size-[1.15rem] shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-5 py-4">
          <p className="text-xs text-subtle">
            FarmBot Web <span className="font-mono">v0.1.0</span>
          </p>
        </div>
      </aside>
    </>
  );
}
