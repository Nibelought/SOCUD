"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getAccessToken, sessionLostLoginUrl } from "@/lib/auth";
import { personColor, userFromToken, type CurrentUser } from "@/lib/currentUser";
import { fetchDocument, keys } from "@/lib/queries";
import { useResource } from "@/hooks/useResource";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { LoadingRegion } from "@/components/ui/Spinner";

const DocumentEditor = dynamic(() => import("@/components/editor/DocumentEditor"), {
    ssr: false,
    loading: () => <LoadingRegion label="Opening the editor" />,
});

export default function DocumentEditPage() {
    const router = useRouter();
    const { id } = useParams<{ id: string }>();
    const [session, setSession] = useState<{ token: string; user: CurrentUser } | null>(null);
    const doc = useResource(keys.document(id), () => fetchDocument(id));
    useDocumentTitle(doc.data ? `Editing ${doc.data.title || 'Untitled'}` : undefined);

    useEffect(() => {
        const token = getAccessToken();
        const user = userFromToken(token);
        if (!token || !user) {
            router.push(sessionLostLoginUrl());
            return;
        }
        setSession({ token, user });
    }, [router]);

    if (!session) return null;

    return (
        <DocumentEditor
            documentId={id}
            token={session.token}
            userName={session.user.name}
            userColor={personColor(session.user.name)}
            meta={doc.data ? { title: doc.data.title, spaceId: doc.data.spaceId, spaceName: doc.data.space?.name } : undefined}
        />
    );
}
