import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
}

export default function PageHeader({ title, description, actions, filters }: PageHeaderProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
      <div className="min-w-0 flex-1">
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {(actions || filters) && (
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 shrink-0">
          {filters}
          {actions}
        </div>
      )}
    </div>
  );
}
