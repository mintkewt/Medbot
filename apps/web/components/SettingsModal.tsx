import React from 'react';
import { X, Moon, Sun, Monitor, LogOut } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="bg-[var(--surface-strong)] rounded-[var(--radius-xl)] w-full max-w-md shadow-2xl border border-[var(--border)] overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-[var(--border)] bg-[var(--surface)]">
          <h3 className="type-section text-foreground">Settings</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--state-hover)] rounded-[var(--radius-pill)] text-[var(--text-subtle)] transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Theme Section */}
          <div>
            <label className="type-caption font-semibold tracking-wide text-[var(--text-muted)] mb-3 block uppercase">Appearance</label>
            <div className="grid grid-cols-3 gap-2 bg-[var(--surface)] p-1 rounded-[var(--radius-pill)]">
              {['light', 'dark', 'system'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex items-center justify-center gap-2 py-2 rounded-[var(--radius-pill)] type-caption font-medium transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    theme === t 
                    ? 'bg-[rgba(201,100,66,0.12)] text-[var(--foreground)] shadow-sm border border-[rgba(201,100,66,0.22)]'
                    : 'text-[var(--text-subtle)] hover:bg-[var(--state-hover)]'
                  }`}
                >
                  {t === 'light' && <Sun size={16} />}
                  {t === 'dark' && <Moon size={16} />}
                  {t === 'system' && <Monitor size={16} />}
                  <span className="capitalize">{t === 'system' ? 'System' : (t === 'light' ? 'Light' : 'Dark')}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Account Section */}
          <div className="pt-4 border-t border-[var(--border)] space-y-3">
            <label className="type-caption font-semibold tracking-wide text-[var(--text-muted)] block uppercase">Account</label>
            {user?.email ? (
              <p className="type-body text-foreground break-all">{user.email}</p>
            ) : null}
            <button
              type="button"
              onClick={() => {
                logout();
                onClose();
                router.replace('/login');
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] py-2.5 type-caption font-medium text-foreground transition-colors duration-[var(--duration-base)] hover:bg-[var(--state-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <LogOut size={16} />
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}