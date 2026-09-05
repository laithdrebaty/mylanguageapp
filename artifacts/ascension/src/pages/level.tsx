import { Link, useLocation } from "wouter";
import { useGetLevel } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelEvaluationCard } from "@/components/level-evaluation-card";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight,
  BookOpen,
  Mic,
  MessageSquare,
  BookMarked,
  GraduationCap,
  Play,
  CheckCircle2,
  Lock,
  RotateCcw,
} from "lucide-react";
import type { LessonSummary } from "@workspace/api-client-react";

export default function Level({ params }: { params: { levelId: string } }) {
  const levelId = parseInt(params.levelId, 10);
  const { data: level, isLoading, error } = useGetLevel(levelId);
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="space-y-4 mt-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error || !level) {
    return (
      <div className="p-8 text-center text-destructive">
        حدث خطأ أثناء تحميل تفاصيل المستوى
      </div>
    );
  }

  const getIcon = (type: string) => {
    switch(type) {
      case "reading": return <BookOpen className="h-5 w-5" />;
      case "speaking":
      case "pronunciation": return <Mic className="h-5 w-5" />;
      case "conversation": return <MessageSquare className="h-5 w-5" />;
      case "vocabulary": return <BookMarked className="h-5 w-5" />;
      case "grammar": return <GraduationCap className="h-5 w-5" />;
      default: return <Play className="h-5 w-5" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch(type) {
      case "speaking": return "bg-rose-100 text-rose-600 border-rose-200";
      case "conversation": return "bg-purple-100 text-purple-600 border-purple-200";
      case "vocabulary": return "bg-amber-100 text-amber-600 border-amber-200";
      case "grammar": return "bg-blue-100 text-blue-600 border-blue-200";
      default: return "bg-teal-100 text-teal-600 border-teal-200";
    }
  };

  const getLessonStateLabel = (lesson: LessonSummary): string => {
    switch (lesson.state) {
      case "LOCKED": return "مقفل";
      case "AVAILABLE": return "متاح";
      case "IN_PROGRESS": return "جارٍ";
      case "COMPLETED": return "مكتمل";
      default: return "";
    }
  };

  const getLessonStateBadgeColor = (lesson: LessonSummary): string => {
    switch (lesson.state) {
      case "LOCKED": return "bg-muted text-muted-foreground";
      case "AVAILABLE": return "bg-emerald-50 text-emerald-700";
      case "IN_PROGRESS": return "bg-blue-50 text-blue-700";
      case "COMPLETED": return "bg-purple-50 text-purple-700";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const progress = level.totalLessons > 0 ? ((level.completedLessons || 0) / level.totalLessons) * 100 : 0;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <button
        onClick={() => setLocation("/learn")}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors mb-4"
      >
        <ArrowRight className="h-4 w-4" />
        العودة للمنهج
      </button>

      {/* Header */}
      <div className="bg-primary text-primary-foreground rounded-3xl p-8 relative overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full blur-2xl translate-y-1/3 -translate-x-1/3"></div>

        <div className="relative z-10">
          <div className="inline-block px-3 py-1 bg-primary-foreground/20 backdrop-blur-sm rounded-full text-sm font-bold mb-4 font-serif tracking-wider" dir="ltr">
            {level.code}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">{level.nameAr}</h1>
          <p className="text-primary-foreground/80 text-lg mb-8" dir="ltr">{level.name}</p>

          <div className="flex items-center gap-4 bg-black/20 p-4 rounded-xl backdrop-blur-sm w-full md:w-2/3">
            <div className="flex-1 space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span>التقدم في هذا المستوى</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2 bg-black/20 [&>div]:bg-amber-400" />
            </div>
            <div className="text-center px-4 border-r border-white/10">
              <div className="text-2xl font-bold">{level.completedLessons}/{level.totalLessons}</div>
              <div className="text-xs text-primary-foreground/70">الدروس</div>
            </div>
          </div>
        </div>
      </div>

      {/* Lessons List */}
      <div className="space-y-4 mt-8">
        <h2 className="text-2xl font-bold text-foreground mb-6">دروس المستوى</h2>

        {level.lessons.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            لا توجد دروس في هذا المستوى بعد.
          </div>
        )}

        {level.lessons.map((lesson) => {
          const isLocked = lesson.state === "LOCKED";
          const isCompleted = lesson.state === "COMPLETED";
          const isInProgress = lesson.state === "IN_PROGRESS";
          const canNavigate = !isLocked;

          return (
            <Link key={lesson.id} href={canNavigate ? `/lesson/${lesson.id}` : "#"}>
              <Card className={`transition-all duration-200 border-2 ${
                isCompleted ? "border-transparent bg-secondary/30" :
                isInProgress ? "border-blue-200 hover:border-blue-400 cursor-pointer shadow-sm" :
                canNavigate ? "border-border hover:border-primary/40 cursor-pointer shadow-sm" :
                "border-transparent bg-muted/30 opacity-75"
              }`}>
                <CardContent className="p-4 md:p-6 flex items-center gap-4 md:gap-6">

                  {/* Status/Type Icon */}
                  <div className={`h-12 w-12 md:h-14 md:w-14 rounded-2xl flex items-center justify-center shrink-0 border ${
                    isCompleted ? "bg-emerald-100 text-emerald-600 border-emerald-200" :
                    isLocked ? "bg-muted text-muted-foreground border-transparent" :
                    getTypeColor(lesson.lessonType)
                  }`}>
                    {isCompleted ? <CheckCircle2 className="h-6 w-6" /> :
                     isLocked ? <Lock className="h-5 w-5" /> :
                     getIcon(lesson.lessonType)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-bold text-muted-foreground">الدرس {lesson.order}</span>
                      <span className="w-1 h-1 rounded-full bg-border"></span>
                      <span className="text-xs font-medium text-muted-foreground capitalize">{lesson.lessonType}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getLessonStateBadgeColor(lesson)}`}>
                        {getLessonStateLabel(lesson)}
                      </span>
                    </div>
                    <h3 className={`text-lg font-bold truncate ${isLocked ? "text-muted-foreground" : "text-foreground"}`}>
                      {lesson.titleAr}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate" dir="ltr">
                      {lesson.title}
                    </p>
                    {lesson.bestScore !== null && lesson.bestScore !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1">
                        أفضل نتيجة: <span className="font-bold text-emerald-600">{lesson.bestScore}%</span>
                      </p>
                    )}
                  </div>

                  {/* Action */}
                  <div className="hidden md:flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-medium text-foreground">{lesson.estimatedMinutes} دقيقة</div>
                      <div className="text-xs text-amber-600 font-bold">+{lesson.xpReward} XP</div>
                    </div>
                    {isCompleted && (
                      <Button variant="outline" className="rounded-xl gap-1" size="sm">
                        <RotateCcw className="h-3 w-3" />
                        مراجعة
                      </Button>
                    )}
                    {(canNavigate && !isCompleted) && (
                      <Button className="rounded-xl">
                        {isInProgress ? "متابعة" : "بدء"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {/* The gate out of this level, once its lessons are done. */}
        <div className="pt-4">
          <LevelEvaluationCard levelId={levelId} />
        </div>
      </div>
    </div>
  );
}
