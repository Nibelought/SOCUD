"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setAccessToken } from '@/lib/auth';
import { publicApi } from '@/lib/api/public-client';
import { apiErrorMessage } from '@/lib/api/errors';
import { DEFAULT_AFTER_LOGIN, SESSION_EXPIRED_PARAM, SESSION_EXPIRED_VALUE, safeNextPath } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { AuthFrame, AuthLink, FieldGroup, GroupedInput } from '../AuthForm';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get(SESSION_EXPIRED_PARAM) === SESSION_EXPIRED_VALUE) setNotice('Your session ended. Sign in again to continue where you were.');
        else if (params.get('registered') === '1') setNotice('Your account is ready. Sign in to continue.');
    }, []);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const { data, error: body, response } = await publicApi.POST('/auth/login', { body: { email: email.trim(), password } });
            if (!data) {
                setError(
                    response.status === 401
                        ? 'The email or password is incorrect.'
                        : response.status === 429
                          ? 'Too many attempts. Wait a minute, then try again.'
                          : apiErrorMessage(body, 'Couldn’t sign in. Check your connection and try again.'),
                );
                return;
            }
            // The refresh token arrives as an httpOnly cookie; only the access token is stored.
            setAccessToken(data.access_token);
            const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
            router.push(next ?? DEFAULT_AFTER_LOGIN);
        } catch {
            setError('Couldn’t reach SOCUD. Check your connection and try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthFrame
            title="Sign in to SOCUD"
            subtitle="Your team’s documents, search and graph."
            footer={
                <>
                    New to SOCUD? <AuthLink href="/register">Create an account</AuthLink>
                </>
            }
        >
            <form onSubmit={submit} className="flex flex-col gap-4">
                {notice && !error && <Notice title={notice} />}
                {error && <Notice tone="error" title={error} />}
                <FieldGroup>
                    <GroupedInput
                        label="Email"
                        type="email"
                        name="email"
                        autoComplete="username"
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
                        name="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Required"
                    />
                </FieldGroup>
                <Button type="submit" variant="primary" size="lg" loading={loading} disabled={!email.trim() || !password}>
                    Sign In
                </Button>
            </form>
        </AuthFrame>
    );
}
