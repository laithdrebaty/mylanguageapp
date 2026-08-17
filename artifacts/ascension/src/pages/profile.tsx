import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetProfile, useUpdateProfile, ProfileUpdatePreferredLanguage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { User as UserIcon, Loader2, Save, Calendar, Globe, BookOpen, Crown } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

const formSchema = z.object({
  name: z.string().min(2, { message: "الاسم يجب أن يكون حرفين على الأقل" }),
  bio: z.string().max(160, { message: "النبذة يجب ألا تتجاوز 160 حرف" }).optional(),
  preferredLanguage: z.nativeEnum(ProfileUpdatePreferredLanguage).default(ProfileUpdatePreferredLanguage.ar),
  country: z.string().default("Syria"),
});

export default function Profile() {
  const { data: profile, isLoading, refetch } = useGetProfile();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      bio: "",
      preferredLanguage: ProfileUpdatePreferredLanguage.ar,
      country: "",
    },
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name,
        bio: profile.bio || "",
        preferredLanguage: profile.preferredLanguage || ProfileUpdatePreferredLanguage.ar,
        country: profile.country || "Syria",
      });
    }
  }, [profile, form]);

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!profile) return null;

  function onSubmit(values: z.infer<typeof formSchema>) {
    updateProfile.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({
            title: "تم تحديث الملف الشخصي",
          });
          setIsEditing(false);
          refetch();
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "خطأ",
            description: "لم نتمكن من تحديث بياناتك",
          });
        }
      }
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      
      {/* Profile Header */}
      <Card className="overflow-hidden border-border bg-gradient-to-br from-card to-secondary/30">
        <CardContent className="p-8 md:p-12 text-center md:text-right flex flex-col md:flex-row items-center gap-8">
          <div className="h-32 w-32 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border-4 border-card shadow-lg relative">
            <UserIcon className="h-16 w-16 text-primary" />
          </div>
          <div className="flex-1 space-y-2 text-center md:text-right">
            <h1 className="text-3xl font-bold text-foreground">{profile.name}</h1>
            <p className="text-muted-foreground text-lg" dir="ltr">{profile.email}</p>
            {profile.bio && (
              <p className="text-foreground mt-4 max-w-md mx-auto md:mx-0 bg-background/50 p-3 rounded-lg border border-border/50">
                {profile.bio}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-4 mt-4 border-t border-border/50 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                انضم في {format(new Date(profile.createdAt), "MMMM yyyy", { locale: ar })}
              </div>
              <div className="flex items-center gap-1.5">
                <Globe className="h-4 w-4" />
                {profile.country || "سوريا"}
              </div>
              <div className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                المستوى: {profile.currentLevelCode}
              </div>
            </div>
          </div>
          
          <Button 
            variant={isEditing ? "outline" : "default"} 
            className="md:self-start rounded-xl"
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? "إلغاء التعديل" : "تعديل الحساب"}
          </Button>
        </CardContent>
      </Card>

      {/* Edit Form */}
      {isEditing ? (
        <Card>
          <CardHeader>
            <CardTitle>تعديل البيانات الشخصية</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>الاسم الكامل</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>البلد</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="اختر البلد" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Syria">سوريا</SelectItem>
                            <SelectItem value="Lebanon">لبنان</SelectItem>
                            <SelectItem value="Jordan">الأردن</SelectItem>
                            <SelectItem value="Other">أخرى</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="preferredLanguage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>لغة الواجهة المفضلة</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="اختر اللغة" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ar">العربية</SelectItem>
                            <SelectItem value="en">English</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>نبذة عنك (اختياري)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="اكتب نبذة قصيرة عن أهدافك من تعلم اللغة..." 
                          className="resize-none"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" disabled={updateProfile.isPending} className="rounded-xl">
                  {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  حفظ التعديلات
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="bg-secondary/30 pb-4">
              <CardTitle className="text-lg">إحصائيات التعلم</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-muted-foreground font-medium">الدروس المنجزة</span>
                <span className="text-xl font-bold text-foreground">{profile.totalLessonsCompleted}</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-muted-foreground font-medium">أيام التتابع (Streak)</span>
                <span className="text-xl font-bold text-amber-600">{profile.streakDays}🔥</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-muted-foreground font-medium">إجمالي النقاط</span>
                <span className="text-xl font-bold text-primary">{profile.totalXp} XP</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-muted-foreground font-medium">حالة اختبار تحديد المستوى</span>
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${profile.placementCompleted ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                  {profile.placementCompleted ? "مكتمل" : "غير مكتمل"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-secondary/30 pb-4">
              <CardTitle className="text-lg">حالة الاشتراك</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
              <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                <Crown className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold capitalize">
                {profile.subscriptionPlan === "free" ? "الباقة المجانية" : 
                 profile.subscriptionPlan === "professional_english" ? "الإنجليزية المهنية" :
                 profile.subscriptionPlan === "general_english" ? "الإنجليزية العامة" : profile.subscriptionPlan}
              </h3>
              <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                أنت حالياً تستخدم الخطة الأساسية للتعلم. للوصول لجميع الميزات يمكنك الترقية.
              </p>
              <Button onClick={() => window.location.href="/subscription"} className="mt-4 rounded-xl" variant="outline">
                إدارة الاشتراك
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
