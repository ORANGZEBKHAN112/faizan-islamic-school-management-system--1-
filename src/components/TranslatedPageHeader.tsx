import type { ReactNode } from 'react';
import PageHeader from './ui/PageHeader';
import { useI18n } from '../context/I18nContext';

interface TranslatedPageHeaderProps {
  module: string;
  description?: ReactNode;
  descriptionKey?: string;
  actions?: ReactNode;
  filters?: ReactNode;
}

export default function TranslatedPageHeader({
  module,
  description,
  descriptionKey,
  actions,
  filters,
}: TranslatedPageHeaderProps) {
  const { t } = useI18n();
  const titleKey = `pages.${module}.title`;
  const descKey = descriptionKey ?? `pages.${module}.description`;

  return (
    <PageHeader
      title={t(titleKey)}
      description={description ?? t(descKey)}
      actions={actions}
      filters={filters}
    />
  );
}
