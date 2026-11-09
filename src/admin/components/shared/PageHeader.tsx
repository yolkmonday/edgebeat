import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";

export type PageHeaderProps = {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  pill?: ReactNode;
  actions?: ReactNode;
};

export const PageHeader = ({ title, breadcrumb, pill, actions }: PageHeaderProps) => (
  <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="flex flex-col gap-2">
      {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">{title}</h1>
        {pill}
      </div>
    </div>
    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
  </header>
);
