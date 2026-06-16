import { ShieldOff } from 'lucide-react';
import { User } from '../types';
import EmptyState from '../components/ui/EmptyState';
import { useI18n } from '../context/I18nContext';

interface NoAccessPageProps {
  user: User;
}

export default function NoAccessPage({ user }: NoAccessPageProps) {
  const { t } = useI18n();

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  return (
    <div className="max-w-lg mx-auto py-8">
      <EmptyState
        icon={ShieldOff}
        title={t('noAccess.title')}
        description={t('noAccess.description', { name: user.fullName, username: user.username })}
        actionLabel={t('noAccess.logout')}
        onAction={handleLogout}
      />
    </div>
  );
}
