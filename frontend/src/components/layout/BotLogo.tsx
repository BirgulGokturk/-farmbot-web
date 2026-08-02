export function BotLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-brand shadow-brand">
        <svg viewBox="0 0 64 64" className="size-5" aria-hidden>
          {/* Gantry portalı — FarmBot'un karakteristik silueti */}
          <path
            d="M14 46V22a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v24M14 30h36M32 34v8"
            fill="none"
            stroke="white"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <rect x="27" y="25" width="10" height="9" rx="2" fill="white" />
        </svg>
      </span>
      <div className="leading-tight">
        <p className="font-display text-[0.95rem] font-semibold text-content">FarmBot</p>
        <p className="text-[0.7rem] text-subtle">Yönetim Paneli</p>
      </div>
    </div>
  );
}
