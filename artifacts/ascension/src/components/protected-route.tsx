import { useEffect } from "react";
import { useLocation, Route } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { AppLayout } from "./layout";

export function ProtectedRoute({ 
  component: Component, 
  requireAdmin,
  path 
}: { 
  component: any;
  requireAdmin?: boolean;
  path: string;
}) {
  const { data: user, isLoading, error } = useGetMe();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (error || !user) {
        setLocation("/login");
      } else if (requireAdmin && user.role !== "admin") {
        setLocation("/dashboard");
      }
    }
  }, [isLoading, error, user, setLocation, requireAdmin]);

  if (isLoading || !user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (requireAdmin && user.role !== "admin") {
    return null; // Will redirect
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
