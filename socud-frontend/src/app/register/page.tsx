"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { publicApi } from '@/lib/api/public-client';
import { apiErrorMessage, caughtMessage } from '@/lib/api/errors';

export default function RegisterPage() {
    const router = useRouter();
    const[email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const[error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const { error, response } = await publicApi.POST('/auth/register', {
                body: { email, password },
            });

            if (!response.ok) {
                throw new Error(apiErrorMessage(error, "Registration failed"));
            }

            // After a successful registration redirect to login
            router.push("/login");
        } catch (err) {
            setError(caughtMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="max-w-md w-full bg-white p-8 border rounded shadow-sm">
                <h2 className="text-2xl font-bold text-center mb-6 text-black">Create Account</h2>
                {error && <div className="mb-4 p-2 bg-red-100 text-red-700 rounded text-sm">{error}</div>}

                <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Email</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded p-2 text-black outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded p-2 text-black outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 text-white p-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? "Registering..." : "Sign Up"}
                    </button>
                </form>
                <div className="mt-4 text-center text-sm text-gray-600">
                    Already have an account? <Link href="/login" className="text-blue-600 hover:underline">Log in</Link>
                </div>
            </div>
        </div>
    );
}