import { Link, useLocation } from "wouter";
import { BookOpen, GraduationCap, Home, User as UserIcon, BookMarked, Settings, LogOut, Loader2, Crown } from "lucide-react";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { Button } from "./ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();
  const logout = useLogout();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Should be redirected by Route guards, but just in case
    return <>{children}</>;
  }

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/login");
      }
    });
  };

  const navItems = [
    { href: "/dashboard", label: "الرئيسية", icon: Home },
    { href: "/learn", label: "المنهج", icon: BookOpen },
    { href: "/vocabulary", label: "المفردات", icon: BookMarked },
    { href: "/profile", label: "حسابي", icon: UserIcon },
  ];

  if (user.role === "admin") {
    navItems.push({ href: "/admin", label: "لوحة الإدارة", icon: Settings });
  }

  return (
    <div dir="rtl" className="min-h-[100dvh] flex flex-col bg-background pb-16 md:pb-0 md:pr-64">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col fixed top-0 right-0 w-64 h-[100dvh] bg-card border-l border-border z-40">
        <div className="p-6 flex items-center gap-3 border-b border-border">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <GraduationCap className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="font-bold text-xl text-foreground font-sans">لغتي</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border space-y-4">
          <Link href="/subscription" className="flex items-center gap-3 px-4 py-3 rounded-lg text-amber-600 bg-amber-50 hover:bg-amber-100 transition-colors">
             <Crown className="h-5 w-5" />
             <span className="font-medium">الاشتراك</span>
          </Link>

          <Button 
            variant="ghost" 
            className="w-full flex items-center justify-start gap-3 text-muted-foreground hover:text-destructive"
            onClick={handleLogout}
            disabled={logout.isPending}
          >
            <LogOut className="h-5 w-5" />
            <span className="font-medium">تسجيل الخروج</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-[100dvh] w-full mx-auto max-w-5xl">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border flex items-center justify-around px-2 z-40">
        {navItems.map((item) => {
          const isActive = location === item.href || location.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
