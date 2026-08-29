import { Link } from "wouter";
import { useGetLevels, useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Unlock, CheckCircle2, ChevronLeft, Target } from "lucide-react";

export default function Learn() {
  const { data: levelsResponse, isLoading, error } = useGetLevels();
  const levels = levelsResponse?.levels;
  const { data: dashboard } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error || !levels) {
    return (
      <div className="p-8 text-center text-destructive">
        حدث خطأ أثناء تحميل المنهج
      </div>
    );
  }

  const currentLevel = dashboard?.currentLevel ?? null;
  const notPlaced = !currentLevel;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-foreground">المنهج الدراسي</h1>
        <p className="text-muted-foreground mt-2">
          من الصفر وحتى الاحتراف. اختر المستوى المتاح لك للبدء.
        </p>
      </div>

      {/* Placement CTA if not placed */}
      {notPlaced && (
        <div className="flex flex-col sm:flex-row items-center gap-4 p-5 rounded-2xl border-2 border-primary/30 bg-primary/5">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Target className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 text-center sm:text-right">
            <p className="font-bold text-foreground">لم يتم تحديد مستواك بعد</p>
            <p className="text-sm text-muted-foreground">أجرِ اختبار تحديد المستوى لفتح الدروس المناسبة لك.</p>
          </div>
          <Link href="/placement">
            <Button className="rounded-xl shrink-0">ابدأ الاختبار</Button>
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {levels.map((level) => {
          const isCurrentLevel = currentLevel?.id === level.id;
          const progress = level.totalLessons > 0
            ? ((level.completedLessons || 0) / level.totalLessons) * 100
            : 0;

          return (
            <Link key={level.id} href={level.isUnlocked ? `/learn/${level.id}` : "#"}>
              <Card className={`relative overflow-hidden transition-all duration-300 h-full flex flex-col ${
                level.isUnlocked
                  ? "cursor-pointer hover:shadow-lg hover:border-primary/50"
                  : "opacity-75 bg-secondary/30"
              } ${isCurrentLevel ? "border-primary shadow-md ring-1 ring-primary/20" : ""}`}>

                {/* Status bar */}
                <div className={`h-1.5 w-full ${
                  level.isCompleted ? "bg-emerald-500" :
                  isCurrentLevel ? "bg-primary" :
                  level.isUnlocked ? "bg-amber-400" : "bg-muted"
                }`} />

                <CardContent className="p-6 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div className="text-2xl font-black font-serif tracking-tighter" dir="ltr">
                      {level.code}
                    </div>
                    {level.isCompleted ? (
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    ) : level.isUnlocked ? (
                      <Unlock className="h-5 w-5 text-amber-500" />
                    ) : (
                      <Lock className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>

                  <h3 className="text-xl font-bold text-foreground mb-1">
                    {level.nameAr}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6 line-clamp-2" dir="ltr">
                    {level.name}
                  </p>

                  <div className="mt-auto space-y-3">
                    <div className="flex justify-between text-xs font-medium text-muted-foreground">
                      <span>{level.completedLessons || 0} من {level.totalLessons} درس</span>
                      {level.isUnlocked && <span>{Math.round(progress)}%</span>}
                    </div>

                    {level.isUnlocked && (
                      <Progress
                        value={progress}
                        className={`h-1.5 ${level.isCompleted ? "[&>div]:bg-emerald-500" : ""}`}
                      />
                    )}
                  </div>

                  {level.isUnlocked && (
                    <div className="mt-6 flex items-center justify-between text-sm font-bold text-primary group-hover:text-primary/80">
                      <span>{level.isCompleted ? "مراجعة" : isCurrentLevel ? "متابعة التعلم" : "ابدأ"}</span>
                      <ChevronLeft className="h-4 w-4" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
