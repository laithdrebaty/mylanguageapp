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

// CMS pages
import CMSDashboard from '@/pages/cms/index';
import CMSLessonsList from '@/pages/cms/lessons-list';
import LessonEditor from '@/pages/cms/lesson-editor';
import LessonPreviewPage from '@/pages/cms/lesson-preview';
import { LanguagesPage, CurriculaPage, LevelsPage } from '@/pages/cms/catalog';
import VocabularyPage from '@/pages/cms/vocabulary';
import MediaPage from '@/pages/cms/media';
import ReviewsPage from '@/pages/cms/reviews';
import AuditLogPage from '@/pages/cms/audit';

const queryClient = new QueryClient();

/** Adapter: pulls route param and passes to component as a plain prop */
function LessonEditorRoute({ params }: { params: { id?: string } }) {
  const id = params.id ? parseInt(params.id) : undefined;
  return <LessonEditor lessonId={id} />;
}

function LessonPreviewRoute({ params }: { params: { id: string } }) {
  return <LessonPreviewPage lessonId={parseInt(params.id)} />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />

        {/* Student routes */}
        <ProtectedRoute path="/dashboard" component={Dashboard} />
        <ProtectedRoute path="/placement" component={Placement} />
        <ProtectedRoute path="/learn" component={Learn} />
        <ProtectedRoute path="/learn/:levelId" component={Level} />
        <ProtectedRoute path="/lesson/:lessonId" component={Lesson} />
        <ProtectedRoute path="/vocabulary" component={Vocabulary} />
        <ProtectedRoute path="/subscription" component={Subscription} />
        <ProtectedRoute path="/profile" component={Profile} />

        {/* Admin routes */}
        <ProtectedRoute path="/admin" component={AdminDashboard} requireAdmin />
        <ProtectedRoute path="/admin/students" component={AdminStudents} requireAdmin />
        <ProtectedRoute path="/admin/lessons" component={AdminLessons} requireAdmin />

        {/* CMS routes — accessible to admin | content_manager | content_reviewer */}
        <ProtectedRoute path="/cms" component={CMSDashboard} requireCMS />
        <ProtectedRoute path="/cms/lessons" component={CMSLessonsList} requireCMS />
        <ProtectedRoute path="/cms/lessons/new" component={LessonEditorRoute} requireCMS />
        <ProtectedRoute path="/cms/lessons/:id/edit" component={LessonEditorRoute} requireCMS />
        <ProtectedRoute path="/cms/lessons/:id/preview" component={LessonPreviewRoute} requireCMS />
        <ProtectedRoute path="/cms/languages" component={LanguagesPage} requireCMS />
        <ProtectedRoute path="/cms/curricula" component={CurriculaPage} requireCMS />
        <ProtectedRoute path="/cms/levels" component={LevelsPage} requireCMS />
        <ProtectedRoute path="/cms/vocabulary" component={VocabularyPage} requireCMS />
        <ProtectedRoute path="/cms/media" component={MediaPage} requireCMS />
        <ProtectedRoute path="/cms/reviews" component={ReviewsPage} requireCMS />
        <ProtectedRoute path="/cms/audit" component={AuditLogPage} requireCMS />

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
