# SOCUD interface design

How the web app looks and behaves, and how to extend it without breaking the system. The interface
takes Apple's Human Interface Guidelines as its reference (macOS for wide windows, iPadOS for
compact ones): familiar structure and controls, with SOCUD's identity in color, type and the graph.

## The idea in one sentence

A quiet, Mac-like workspace where **every space has its own color**, and that color follows the
space everywhere: sidebar, tiles, breadcrumbs, search results and the knowledge graph. People learn
to recognize a space by it, as they do with lists in Calendar and Reminders.

Everything else stays restrained. Documents are set in a reading serif so long-form knowledge reads
well, and KaTeX's serif math sits naturally in the text.

## Principles

1. **Content first.** Controls float on a translucent toolbar; documents get a 68-character column.
2. **One place for everything.** Search (⌘K or `/`) finds any document; the sidebar reaches every
   space; sheets handle short tasks without leaving the screen.
3. **Familiar before novel.** Sidebar + toolbar + sheets, title-style button labels, Cancel as the
   default in alerts, Undo instead of a confirmation for reversible actions (archive).
4. **Say what happened.** Toasts confirm ("Published version 4"); errors say what went wrong and
   what to do; empty screens offer the next action. No `alert()`, no `confirm()`, no `prompt()`.
5. **Works for everyone.** Light and dark follow the system; Increase Contrast and Reduce
   Transparency make materials opaque; Reduce Motion drops animation; everything works by keyboard.

## Tokens (`src/app/globals.css`)

Tailwind's default palette and font families are **removed**: only the tokens below exist, so an
off-system color fails the build. Each token has a light and a dark value.

| Role | Utility | Light | Dark | Notes |
| --- | --- | --- | --- | --- |
| Window | `bg-window` | #FFFFFF | #1C1C1E | Content background |
| Sidebar | `bg-sidebar` | #F4F4F6 | #232326 | |
| Grouped | `bg-grouped` | #F2F2F7 | #111113 | Form groups, empty states, auth |
| Elevated | `bg-elevated` | #FFFFFF | #2A2A2D | Sheets, menus, popovers, toasts |
| Label | `text-label` | #1D1D1F | #F5F5F7 | 16.8:1 / 15.6:1 |
| Secondary label | `text-label-2` | #6E6E73 | #A1A1A6 | 5.1:1 / 6.6:1 on window |
| Tertiary label | `text-label-3` | #8E8E93 | #7C7C82 | Icons and placeholders only |
| Accent | `bg-accent` `text-accent` | #2256D9 | #5A9CFF | Primary action, selection, links. 6.2:1 |
| Danger / warning / success | `text-danger` … | #D70015 / #A35200 / #1F7A37 | #FF6961 / #FFB340 / #30D158 | |
| Fills | `bg-fill` `bg-fill-strong` `bg-hover` `bg-selection` | translucent grays | | Controls, rows |
| Separator | `border-separator` | 16% gray | | Hairlines |
| Tint | `bg-tint` `text-tint` | `--tint` | | Set inline from a space color |

**Space colors**: twelve hues (`--space-red` … `--space-graphite`), each with a dark-mode value.
White glyphs on them are at least 3.8:1. `src/lib/spaceColor.ts` picks one from the space id
(stable, no backend field yet; pass `override` once the API stores a color). Use
`style={spaceTint(id)}` plus `bg-tint`, or `<SpaceIcon>`.

**Type**: UI uses the system face (SF Pro on Apple devices). Documents use Source Serif 4 (Latin and
Cyrillic) at 18 px / 1.65. Scale: `text-caption` 12, `text-footnote` 13, `text-body` 14 (UI default,
the web equivalent of macOS's 13 pt), `text-headline` 15, `text-title3` 17, `text-title2` 20,
`text-title1` 26 (large title), `text-display` 34 (document title). Nothing below 12 px.

**Shape**: `rounded-control` 7, `rounded-field` 8, `rounded-tile` 12, `rounded-sheet` 16.

**Materials**: `.material` (toolbar), `.material-sidebar`, `.material-floating` (floating capsules
over the graph and the editor). Only on the functional layer, never on content.

## Layout

```text
regular width (≥ 900 px)                       compact width
┌──────────┬──────────────────────────────┐    ┌──────────────────────────┐
│ SOCUD  ◧ │ ◧ Space › Title   ⋯ [Primary]│    │ ◧ Title       [Primary] ●│
│ 🔍 Search│──────────────────────────────│    │──────────────────────────│
│ Home     │                              │    │ Large title              │
│ Graph    │   Large title                │    │ content, full width      │
│ Spaces + │   content (max 1040 / 740)   │    │                          │
│ ▸ ■ Eng  │                              │    │ (sidebar slides over,    │
│ ▸ ■ Math │                              │    │  closes after navigating)│
└──────────┴──────────────────────────────┘    └──────────────────────────┘
```

- `AppShell` (in `app/(app)/layout.tsx`) holds the sidebar, search, the New Space / New Document
  sheets and the feedback provider for every signed-in screen.
- Each screen is a `<Page toolbar={<Toolbar …/>}>`: a scroll view whose toolbar floats over the top
  edge and gains a hairline once content scrolls under it. With a `<PageHeader>` (large title), the
  toolbar's small title appears only after the large one scrolls away.
- The sidebar shows two levels at most (space › documents) and hides with ⌃⌘S or its button.

## Components

| Component | File | Use |
| --- | --- | --- |
| `Button`, `ButtonLink`, `IconButton` | `components/ui/Button.tsx` | `primary` once or twice per view; `IconButton` always has a label and tooltip |
| `TextField`, `TextArea`, `SelectField`, `Select` | `components/ui/Field.tsx` | Visible label, hint, inline error |
| `Sheet` | `components/ui/Sheet.tsx` | One short task; native `<dialog>` (focus trap, Esc, inert page) |
| `useFeedback().toast / confirm` | `components/ui/Feedback.tsx` | Toasts (optional Undo action) and alerts |
| `Notice` | `components/ui/Feedback.tsx` | Status inside a view (archived, offline, warnings) |
| `Menu`, `Popover` | `components/ui/Menu.tsx` | Pull-down menus (arrow keys, type-ahead) and anchored panels |
| `SegmentedControl`, `Avatar`, `SpaceIcon`, `EmptyState`, `SkeletonRows`, `Kbd`, `SectionHeader` | `components/ui/Bits.tsx` | |
| `Page`, `Toolbar`, `PageHeader`, `Content` | `components/shell/Page.tsx` | Screen structure |
| `useApp()` | `components/shell/AppContext.tsx` | Current user, spaces, opening search and sheets |
| `useResource`, `invalidate` | `hooks/useResource.ts` | Data with a shared cache; keys in `lib/queries.ts` |

## Writing

- Buttons, menu items and sheet titles use title-style capitalization: "New Document", "Move to
  Trash", "Version History…". An ellipsis means the command asks for more before acting.
- Body text, hints and section headings use sentence case: "Recently updated", "People with access".
- A command keeps its name through the flow: **Publish** → "Published version 3".
- Errors: what happened and what to do, without apology: "Couldn’t rename. Editors and owners can
  rename."
- Use typographic quotes and apostrophes (’ “ ”) and the ellipsis character (…).

## Adding a feature

- **A new screen**: add `app/(app)/<route>/page.tsx` returning `<Page toolbar={<Toolbar title=…/>}>`
  with `<Content><PageHeader …/>…</Content>`. Protected route prefixes live in `lib/session.ts` and
  the matcher in `proxy.ts`.
- **A new place in the sidebar** (Trash, Starred, Settings): add a `NavRow` in `Sidebar.tsx`. Keep
  critical actions out of the sidebar's bottom.
- **A new short task**: a `Sheet` with Cancel + one primary button in the footer. If any screen can
  start it, keep its open state in `AppContext` and render it in `AppShell`, like New Space.
- **A destructive action**: reversible → do it, then toast with Undo. Irreversible → `confirm({
  destructive: true })` with Cancel as the default.
- **New data**: add a key and a loader to `lib/queries.ts`, read it with `useResource`, and call
  `invalidate(key)` after any mutation that changes it.
- **A new color**: add a semantic token (light, dark, contrast note) in `globals.css` and expose it
  in `@theme inline`. Don't use raw hex values in components.

## Accessibility checklist

- Contrast ≥ 4.5:1 for text (computed above); 3:1 for large text and meaningful graphics.
- Every icon-only control has `label` (IconButton) or `aria-label`.
- Focus is visible (`:focus-visible` ring) and never trapped outside a dialog.
- Lists and the graph have a non-visual equivalent (the graph renders a hidden link list).
- Check light, dark, Increase Contrast, Reduce Transparency and Reduce Motion, and widths from 360 px.
