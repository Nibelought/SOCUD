import { useEffect } from 'react';

/** Browser tab title for client screens whose title comes from data ("Research Notes – SOCUD"). */
export function useDocumentTitle(title: string | undefined): void {
    useEffect(() => {
        if (title) document.title = `${title} – SOCUD`;
    }, [title]);
}
