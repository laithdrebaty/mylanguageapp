import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPlacementTest,
  useSubmitPlacementTest,
  getGetDashboardQueryKey,
  getGetLevelsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PlacementTestResult } from "@workspace/api-client-react";

export default function Placement() {
  const { data: test, isLoading, error } = useGetPlacementTest();
  const submitTest = useSubmitPlacementTest();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<PlacementTestResult | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !test) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-20">
        <h2 className="text-xl font-bold text-destructive mb-4">حدث خطأ في تحميل الاختبار</h2>
        <Button onClick={() => window.location.reload()}>إعادة المحاولة</Button>
      </div>
    );
  }

  if (result) {
    return (
      <div dir="rtl" className="min-h-[100dvh] flex items-center justify-center p-4 bg-background">
        <Card className="max-w-lg w-full text-center border-primary shadow-2xl animate-in zoom-in-95 duration-500">
          <div className="h-3 w-full bg-primary" />
          <CardContent className="pt-10 pb-8 px-6 space-y-6">
            <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-3xl font-bold text-foreground">تم تحديد مستواك بنجاح!</h2>

            <div className="p-6 bg-secondary rounded-2xl space-y-2">
              <p className="text-muted-foreground mb-2">المستوى الخاص بك هو</p>
              <div className="text-4xl font-bold text-primary" dir="ltr">{result.assignedLevelCode}</div>
              <div className="text-xl font-bold text-foreground">{result.assignedLevelNameAr}</div>
              <div className="text-sm text-muted-foreground" dir="ltr">{result.assignedLevelName}</div>
            </div>

            <p className="text-muted-foreground text-sm">
              بناءً على نتيجة {result.score} من {result.total} ({result.percentage}%) في اختبار تحديد المستوى.
            </p>

            {result.messageAr && (
              <p className="text-sm font-medium text-foreground bg-secondary/60 p-3 rounded-lg">
                {result.messageAr}
              </p>
            )}

            <Button
              size="lg"
              className="w-full h-14 text-lg rounded-xl mt-4"
              onClick={() => setLocation("/dashboard")}
            >
              الانتقال للرئيسية
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Zero questions edge case
  if (test.questions.length === 0) {
    return (
      <div dir="rtl" className="min-h-[100dvh] flex items-center justify-center p-4 bg-background">
        <Card className="max-w-xl w-full border-border shadow-lg">
          <CardContent className="p-8 text-center space-y-6">
            <h1 className="text-2xl font-bold text-foreground">الاختبار غير متاح</h1>
            <p className="text-muted-foreground">لا توجد أسئلة في الاختبار حالياً. يرجى المحاولة لاحقاً.</p>
            <Button onClick={() => setLocation("/dashboard")}>العودة للرئيسية</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!started) {
    return (
      <div dir="rtl" className="min-h-[100dvh] flex items-center justify-center p-4 bg-background">
        <Card className="max-w-xl w-full border-border shadow-lg">
          <CardContent className="p-8 text-center space-y-6">
            <div className="h-16 w-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🎯</span>
            </div>
            <h1 className="text-3xl font-bold text-foreground">اختبار تحديد المستوى</h1>
            <p className="text-muted-foreground text-lg leading-relaxed">
              لمعرفة من أين يجب أن تبدأ رحلتك معنا، قمنا بإعداد هذا الاختبار القصير.
              الاختبار يتكون من {test.questions.length} سؤال.
            </p>
            <p className="text-sm text-amber-600 font-medium bg-amber-50 p-3 rounded-lg">
              ملاحظة: إذا كنت لا تعرف الإجابة، يفضل تخطي السؤال لكي يتم تحديد مستواك بدقة بدلاً من التخمين.
            </p>
            <Button
              size="lg"
              className="w-full h-14 text-lg rounded-xl mt-4 bg-primary hover:bg-primary/90"
              onClick={() => setStarted(true)}
            >
              ابدأ الاختبار الآن
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const question = test.questions[currentIndex];
  const isLast = currentIndex === test.questions.length - 1;
  const progress = ((currentIndex + 1) / test.questions.length) * 100;

  const handleSelectOption = (optionId: string) => {
    setAnswers(prev => ({ ...prev, [question.id]: optionId }));
  };

  const handleSubmit = () => {
    const formattedAnswers = Object.entries(answers)
      .map(([qId, oId]) => ({
        questionId: parseInt(qId, 10),
        selectedOptionId: oId,
      }));

    submitTest.mutate(
      { data: { answers: formattedAnswers } },
      {
        onSuccess: async (data) => {
          // Invalidate dashboard and levels before navigating
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetLevelsQueryKey() }),
          ]);
          setResult(data);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "حدث خطأ",
            description: "لم نتمكن من إرسال إجاباتك، يرجى المحاولة مرة أخرى.",
          });
        }
      }
    );
  };

  const handleNext = () => {
    if (isLast) {
      handleSubmit();
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handleSkip = () => {
    if (isLast) {
      handleSubmit();
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  };

  return (
    <div dir="rtl" className="min-h-[100dvh] flex flex-col p-4 bg-background max-w-2xl mx-auto w-full pt-12 md:pt-24">
      {/* Progress */}
      <div className="mb-8 space-y-2">
        <div className="flex justify-between text-sm font-medium text-muted-foreground">
          <span>السؤال {currentIndex + 1} من {test.questions.length}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Question Card */}
      <Card className="border-border shadow-md mb-6 animate-in slide-in-from-right-8 duration-300">
        <CardContent className="p-6 md:p-8 space-y-6">
          <div dir="ltr" className="text-2xl font-bold text-foreground text-center my-4 font-serif">
            {question.questionText}
          </div>
          {question.questionTextAr && (
            <div className="text-muted-foreground text-center mb-8">
              {question.questionTextAr}
            </div>
          )}

          <div className="space-y-3" dir="ltr">
            {question.options.map(option => (
              <button
                key={option.id}
                onClick={() => handleSelectOption(option.id)}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all duration-200 flex items-center justify-between ${
                  answers[question.id] === option.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/40 bg-card hover:bg-secondary/30"
                }`}
              >
                <span className="text-lg font-medium text-foreground">{option.text}</span>
                <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                  answers[question.id] === option.id ? "border-primary bg-primary" : "border-muted-foreground"
                }`}>
                  {answers[question.id] === option.id && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex justify-between items-center mt-4">
        <Button
          variant="ghost"
          onClick={handleSkip}
          className="text-muted-foreground"
          disabled={submitTest.isPending}
        >
          لا أعرف الإجابة (تخطي)
        </Button>

        <Button
          onClick={handleNext}
          size="lg"
          className="h-12 px-8 rounded-xl"
          disabled={submitTest.isPending || !answers[question.id]}
        >
          {submitTest.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isLast ? (
            "إنهاء الاختبار"
          ) : (
            <>
              التالي
              <ArrowLeft className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
