import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

export type BreadcrumbItem = { label: string; to?: string };

export const Breadcrumb = ({ items }: { items: BreadcrumbItem[] }) => (
  <nav aria-label="Breadcrumb">
    <ol className="flex items-center gap-1.5 text-sm text-muted">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {item.to && !last ? (
              <Link to={item.to} className="rounded-sm hover:text-text">
                {item.label}
              </Link>
            ) : (
              <span aria-current={last ? "page" : undefined} className={last ? "text-text" : undefined}>
                {item.label}
              </span>
            )}
            {last ? null : <ChevronRight size={14} aria-hidden />}
          </li>
        );
      })}
    </ol>
  </nav>
);
