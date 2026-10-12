import type { ReactNode } from "react";

// The one page header used by every inner page: a small accent eyebrow that
// says where you are, the serif title, an optional lede, then any extras.
export function PageHeader({ eyebrow, title, lede, children }: { eyebrow: ReactNode; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pageHead">
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="h1">{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </div>
  );
}
