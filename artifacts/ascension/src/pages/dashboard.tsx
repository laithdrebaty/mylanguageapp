import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetDashboard, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Flame, Star, Play, CheckCircle2, BookOpen, Target } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
        <Skeleton className="h-12 w-64 rounded-xl" />
        <div className="grid md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold text-destructive">حدث خطأ أثناء تحميل البيانات</h2>
        <Button className="mt-4" onClick={() => window.location.reload()}>إعادة المحاولة</Button>
      </div>
    );
  }

  const { student, currentCurriculum, currentLevel, nextLesson, weeklyProgress, recentActivity, lessonStateCounts } = dashboard;
  const notPlaced = !currentLevel;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">

      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            مرحباً، {student.name.split(' ')[0]} 👋
          </h1>
          {currentLevel ? (
            <p className="text-muted-foreground mt-2 text-lg">
              أنت حالياً في المستوى{" "}
              <span className="font-bold text-primary">{currentLevel.nameAr} ({currentLevel.code})</span>
            </p>
          ) : (
            <p className="text-muted-foreground mt-2 text-lg">
              لم يتم تحديد مستواك بعد
            </p>
          )}
          {currentCurriculum && (
            <p className="text-sm text-muted-foreground mt-1">
              المنهج: <span className="font-medium">{currentCurriculum.nameInLearnerLanguage || currentCurriculum.name}</span>
            </p>
          )}
        </div>

        {student.subscriptionPlan === "free" && (
          <Link href="/subscription">
            <Button variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50">
              ترقية الحساب 👑
            </Button>
          </Link>
        )}
      </div>

      {/* Placement CTA */}
      {notPlaced && (
        <Card className="border-2 border-primary/40 bg-primary/5 shadow-md">
          <CardContent className="p-6 flex flex-col md:flex-row items-center gap-6">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Target className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1 text-center md:text-right">
              <h3 className="text-xl font-bold text-foreground mb-1">ابدأ باختبار تحديد المستوى</h3>
              <p className="text-muted-foreground text-sm">
                لم يتم تحديد مستواك بعد. أجب على بضعة أسئلة قصيرة لنضعك في المستوى المناسب.
              </p>
            </div>
            <Link href="/placement">
              <Button size="lg" className="rounded-xl h-12 px-8 shrink-0">
                ابدأ الاختبار
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-100 shadow-sm">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
              <Flame className="h-6 w-6 text-amber-500" />
            </div>
            <div className="text-3xl font-bold text-amber-700">{weeklyProgress.streakDays}</div>
            <p className="text-sm font-medium text-amber-600/80">أيام التتابع</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-teal-50 to-emerald-50 border-teal-100 shadow-sm">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-teal-100 flex items-center justify-center">
              <Star className="h-6 w-6 text-teal-600" />
            </div>
            <div className="text-3xl font-bold text-teal-700">{student.totalXp || 0}</div>
            <p className="text-sm font-medium text-teal-600/80">إجمالي النقاط (XP)</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100 shadow-sm">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <BookOpen className="h-6 w-6 text-blue-600" />
            </div>
            <div className="text-3xl font-bold text-blue-700">{weeklyProgress.lessonsThisWeek}</div>
            <p className="text-sm font-medium text-blue-600/80">دروس هذا الأسبوع</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border-purple-100 shadow-sm">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-purple-600" />
            </div>
            <div className="text-3xl font-bold text-purple-700">{student.totalLessonsCompleted}</div>
            <p className="text-sm font-medium text-purple-600/80">إجمالي الدروس</p>
          </CardContent>
        </Card>
      </div>

      {/* Lesson state counts */}
      {lessonStateCounts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "متاحة", value: lessonStateCounts.available, color: "text-emerald-700 bg-emerald-50 border-emerald-100" },
            { label: "جارية", value: lessonStateCounts.inProgress, color: "text-blue-700 bg-blue-50 border-blue-100" },
            { label: "مكتملة", value: lessonStateCounts.completed, color: "text-purple-700 bg-purple-50 border-purple-100" },
            { label: "مقفلة", value: lessonStateCounts.locked, color: "text-slate-600 bg-slate-50 border-slate-100" },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl border p-4 text-center ${color}`}>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs font-medium mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        {/* Next Lesson (Main Action) */}
        <div className="md:col-span-2 space-y-6">
          <h2 className="text-xl font-bold text-foreground">الدرس التالي</h2>

          {notPlaced ? (
            <Card className="border-dashed bg-secondary/50">
              <CardContent className="p-12 text-center">
                <div className="h-16 w-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Target className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">أجرِ اختبار تحديد المستوى أولاً</h3>
                <p className="text-muted-foreground mb-6 text-sm">بعد الاختبار ستظهر هنا دروسك المقترحة.</p>
                <Link href="/placement">
                  <Button size="lg" className="rounded-xl">ابدأ الاختبار</Button>
                </Link>
              </CardContent>
            </Card>
          ) : nextLesson ? (
            <Card className="overflow-hidden border-2 hover:border-primary transition-colors duration-300">
              <div className="h-2 bg-primary w-full"></div>
              <CardContent className="p-6 md:p-8 flex flex-col md:flex-row items-center gap-6">
                <div className="flex-1 space-y-4 text-center md:text-right">
                  <div className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-sm font-bold">
                    الدرس {nextLesson.order}
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">
                    {nextLesson.titleAr}
                  </h3>
                  <p className="text-muted-foreground text-lg" dir="ltr">
                    {nextLesson.title}
                  </p>
                  <p className="text-sm text-muted-foreground pt-2">
                    المدة المتوقعة: {nextLesson.estimatedMinutes} دقائق • يمنح {nextLesson.xpReward} XP
                  </p>
                </div>

                <Link href={`/lesson/${nextLesson.id}`}>
                  <Button size="lg" className="h-16 px-8 rounded-2xl text-lg w-full md:w-auto shadow-md hover:shadow-lg">
                    <Play className="ml-2 h-6 w-6 fill-current" />
                    ابدأ الدرس
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed bg-secondary/50">
              <CardContent className="p-12 text-center">
                <div className="h-16 w-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Star className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold mb-2">أكملت جميع الدروس!</h3>
                <p className="text-muted-foreground mb-6">أنت جاهز للانتقال للمستوى التالي.</p>
                <Link href="/learn">
                  <Button size="lg" className="rounded-xl">استعراض المنهج</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Level Progress */}
          {currentLevel && (
            <div className="space-y-3 pt-4">
              <div className="flex justify-between text-sm font-medium">
                <span>تقدم المستوى ({currentLevel.code})</span>
                <span>{dashboard.levelProgressPercent}%</span>
              </div>
              <Progress value={dashboard.levelProgressPercent} className="h-3 rounded-full" />
              <p className="text-xs text-muted-foreground text-left">
                أكملت {dashboard.totalLessonsCompleted} من {dashboard.totalLessonsInLevel} درساً
              </p>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-foreground flex items-center justify-between">
            <span>النشاط الأخير</span>
          </h2>

          <Card>
            <CardContent className="p-0">
              {recentActivity && recentActivity.length > 0 ? (
                <div className="divide-y divide-border">
                  {recentActivity.map((activity, idx) => (
                    <div key={idx} className="p-4 flex items-start gap-4 hover:bg-secondary/30 transition-colors">
                      <div className="mt-1">
                        {activity.passed ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                        ) : (
                          <div className="h-5 w-5 rounded-full border-2 border-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">
                          {activity.lessonTitleAr || activity.lessonTitle}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{format(new Date(activity.completedAt), 'd MMMM', { locale: ar })}</span>
                          <span>•</span>
                          <span dir="ltr">{activity.score}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  لا يوجد نشاط مسجل بعد.<br/> ابدأ درسك الأول!
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
