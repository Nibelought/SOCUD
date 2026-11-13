const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const sameYear = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });
const otherYear = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
const full = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' });

/**
 * Short, human time for lists: "Just now", "5 minutes ago", "Yesterday", "3 days ago", then a date
 * ("12 Nov", or "12 Nov 2025" in another year). Future dates (clock skew) read as "Just now".
 */
export function relativeTime(value: string | Date, now: number = Date.now()): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    const time = date.getTime();
    if (Number.isNaN(time)) return '';
    const diff = now - time;

    if (diff < MINUTE) return 'Just now';
    if (diff < HOUR) return relative.format(-Math.floor(diff / MINUTE), 'minute');
    if (diff < DAY) return relative.format(-Math.floor(diff / HOUR), 'hour');

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const days = Math.ceil((startOfToday.getTime() - time) / DAY);
    if (days <= 1) return capitalize(relative.format(-1, 'day'));
    if (days < 7) return relative.format(-days, 'day');

    return (date.getFullYear() === new Date(now).getFullYear() ? sameYear : otherYear).format(date);
}

/** Full date and time, for tooltips and version history ("November 12, 2026 at 3:04 PM"). */
export function fullDate(value: string | Date): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    return Number.isNaN(date.getTime()) ? '' : full.format(date);
}

/** "1 document", "3 documents". */
export function plural(count: number, one: string, many = `${one}s`): string {
    return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
