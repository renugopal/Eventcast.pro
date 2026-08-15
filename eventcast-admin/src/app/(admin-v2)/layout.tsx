import { AdminShell } from "./_components/AdminShell";

export default function AdminV2Layout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
