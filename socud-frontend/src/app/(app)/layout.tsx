import { AppShell } from "@/components/shell/AppShell";

/** Signed-in screens share the window frame: sidebar, search, sheets and feedback. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
