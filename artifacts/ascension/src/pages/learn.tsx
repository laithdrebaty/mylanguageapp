import { Link } from "wouter";
import { useGetLevels, useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Unlock, CheckCircle2, ChevronLeft } from "lucide-react";

export default function Learn() {
  const { data: levels, isLoading, error } = useGetLevels();
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

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-foreground">المنهج الدراسي</h1>
        <p className="text-muted-foreground mt-2">
          من الصفر وحتى الاحتراف. اختر المستوى المتاح لك للبدء.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {levels.map((level) => {
          const isCurrentLevel = dashboard?.currentLevel.id === level.id;
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
                      <span>{level.isCompleted ? "مراجعة" : "متابعة التعلم"}</span>
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
