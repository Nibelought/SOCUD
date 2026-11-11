"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { setAccessToken } from '@/lib/auth';
import { publicApi } from '@/lib/api/public-client';
import { apiErrorMessage } from '@/lib/api/errors';
import { DEFAULT_AFTER_LOGIN } from '@/lib/session';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { AuthFrame, AuthLink, FieldGroup, GroupedInput } from '../AuthForm';

const MIN_PASSWORD = 10;

export default function RegisterPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const longEnough = password.length >= MIN_PASSWORD;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!longEnough) return;
        setLoading(true);
        setError(null);
        try {
            const body = { email: email.trim(), password };
            const registered = await publicApi.POST('/auth/register', { body });
            if (!registered.response.ok) {
                setError(
                    registered.response.status === 409
                        ? 'An account with this email already exists. Sign in instead.'
                        : apiErrorMessage(registered.error, 'Couldn’t create the account. Check the details and try again.'),
                );
                return;
            }
            // Sign straight in, so a new account lands in the app rather than on another form.
            const { data } = await publicApi.POST('/auth/login', { body });
            if (data?.access_token) {
                setAccessToken(data.access_token);
                router.push(DEFAULT_AFTER_LOGIN);
            } else {
                router.push('/login?registered=1');
            }
        } catch {
            setError('Couldn’t reach SOCUD. Check your connection and try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthFrame
            title="Create your account"
            subtitle="Start a space for your team’s knowledge."
            footer={
                <>
                    Already have an account? <AuthLink href="/login">Sign in</AuthLink>
                </>
            }
        >
            <form onSubmit={submit} className="flex flex-col gap-4">
                {error && <Notice tone="error" title={error} />}
                <FieldGroup>
                    <GroupedInput
                        label="Email"
                        type="email"
                        name="email"
                        autoComplete="email"
                        inputMode="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        autoFocus
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                    />
                    <GroupedInput
                        label="Password"
                        type="password"
                        name="new-password"
                        autoComplete="new-password"
                        required
                        minLength={MIN_PASSWORD}
                        aria-describedby="password-rule"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Required"
                    />
                </FieldGroup>
                <p id="password-rule" className={cn('-mt-1 flex items-center gap-1.5 px-1 text-footnote', longEnough ? 'text-success' : 'text-label-2')}>
                    <Check className={cn('size-3.5', !longEnough && 'opacity-40')} strokeWidth={2.5} aria-hidden />
                    At least {MIN_PASSWORD} characters
                </p>
                <Button type="submit" variant="primary" size="lg" loading={loading} disabled={!email.trim() || !longEnough}>
                    Create Account
                </Button>
            </form>
        </AuthFrame>
    );
}
