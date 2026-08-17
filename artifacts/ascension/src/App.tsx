import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ProtectedRoute } from '@/components/protected-route';

import Landing from '@/pages/landing';
import Login from '@/pages/login';
import Register from '@/pages/register';
import Dashboard from '@/pages/dashboard';
import Placement from '@/pages/placement';
import Learn from '@/pages/learn';
import Level from '@/pages/level';
import Lesson from '@/pages/lesson';
import Vocabulary from '@/pages/vocabulary';
import Subscription from '@/pages/subscription';
import Profile from '@/pages/profile';
import AdminDashboard from '@/pages/admin/dashboard';
import AdminStudents from '@/pages/admin/students';
import AdminLessons from '@/pages/admin/lessons';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />

        <ProtectedRoute path="/dashboard" component={Dashboard} />
        <ProtectedRoute path="/placement" component={Placement} />
        <ProtectedRoute path="/learn" component={Learn} />
        <ProtectedRoute path="/learn/:levelId" component={Level} />
        <ProtectedRoute path="/lesson/:lessonId" component={Lesson} />
        <ProtectedRoute path="/vocabulary" component={Vocabulary} />
        <ProtectedRoute path="/subscription" component={Subscription} />
        <ProtectedRoute path="/profile" component={Profile} />

        {/* Admin Routes */}
        <ProtectedRoute path="/admin" component={AdminDashboard} requireAdmin />
        <ProtectedRoute path="/admin/students" component={AdminStudents} requireAdmin />
        <ProtectedRoute path="/admin/lessons" component={AdminLessons} requireAdmin />

        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
