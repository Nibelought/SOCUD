"use client";

import { LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Bits';
import { Menu } from '@/components/ui/Menu';
import { useApp } from './AppContext';

/** The signed-in person and account commands. Future: profile, preferences. */
export function AccountMenu({ floating }: { floating?: boolean }) {
    const { user } = useApp();
    const name = user?.name ?? '';
    return (
        <Menu
            label="Account"
            align="end"
            className="min-w-[240px]"
            items={[
                { heading: user?.email || 'Signed in' },
                { separator: true },
                { label: 'Sign Out', icon: LogOut, onSelect: () => void logout() },
            ]}
            trigger={(props) => (
                <button
                    {...props}
                    type="button"
                    aria-label={user ? `Account: ${user.email}` : 'Account'}
                    title={user?.email}
                    className={cn(
                        'inline-flex size-8 items-center justify-center rounded-full hover:bg-hover',
                        floating && 'material-floating',
                    )}
                >
                    {user ? <Avatar name={name} colorKey={user.id} size={24} /> : <span className="size-6 rounded-full bg-fill" />}
                </button>
            )}
        />
    );
}
