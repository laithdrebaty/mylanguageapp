import { useEffect } from "react";
import { useLocation, Route } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { AppLayout } from "./layout";

type Role = "student" | "admin" | "content_manager" | "content_reviewer";

export function ProtectedRoute({ 
  component: Component, 
  requireAdmin,
  requireCMS,
  path 
}: { 
  component: any;
  requireAdmin?: boolean;
  /** Allow admin | content_manager | content_reviewer */
  requireCMS?: boolean;
  path: string;
}) {
  const { data: user, isLoading, error } = useGetMe();
  const [location, setLocation] = useLocation();

  const CMS_ROLES: Role[] = ["admin", "content_manager", "content_reviewer"];

  const hasCMSAccess = (role?: Role) => role && CMS_ROLES.includes(role);

  useEffect(() => {
    if (!isLoading) {
      if (error || !user) {
        setLocation("/login");
      } else if (requireAdmin && user.role !== "admin") {
        setLocation("/dashboard");
      } else if (requireCMS && !hasCMSAccess(user.role as Role)) {
        setLocation("/dashboard");
      }
    }
  }, [isLoading, error, user, setLocation, requireAdmin, requireCMS]);

  if (isLoading || !user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (requireAdmin && user.role !== "admin") return null;
  if (requireCMS && !hasCMSAccess(user.role as Role)) return null;

  // CMS routes manage their own layout (CMSLayout)
  if (requireCMS) {
    return (
      <Route path={path}>
        {(params) => <Component params={params} />}
      </Route>
    );
  }

  return (
    <Route path={path}>
      {(params) => (
        <AppLayout>
          <Component params={params} />
        </AppLayout>
      )}
    </Route>
  );
}
