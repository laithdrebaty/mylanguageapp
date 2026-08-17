import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { BookOpen, Mic, Award, CheckCircle2, ChevronLeft, LogIn } from "lucide-react";
import heroImg from "@assets/generated_images/landing-hero.jpg";
import { useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";

export default function Landing() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

  return (
    <div dir="rtl" className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="fixed top-0 w-full border-b border-border bg-background/80 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
             <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-primary-foreground" />
             </div>
             <span className="font-bold text-2xl text-foreground">لغتي</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium hover:text-primary transition-colors">
              تسجيل الدخول
            </Link>
            <Link href="/register">
               <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white rounded-full px-6">
                 ابدأ مجاناً
               </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-40 md:pb-24">
        <div className="container mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold leading-tight text-foreground">
              تحدث الإنجليزية <br/> بثقة، من قلب دمشق.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-lg leading-relaxed">
              لغتي هي المنصة الأولى المصممة خصيصاً للمتعلم السوري. منهج متكامل يركز على المحادثة، النطق، والاستخدام الحقيقي للغة بعيداً عن حشو القواعد المعقدة.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 rounded-xl bg-primary hover:bg-teal-800">
                  ابدأ رحلتك الآن
                  <ChevronLeft className="mr-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 rounded-xl border-border">
                  لدي حساب سابق
                </Button>
              </Link>
            </div>
          </div>
          <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-border">
            <div className="absolute inset-0 bg-primary/10 mix-blend-multiply z-10 rounded-3xl"></div>
            <img 
              src={heroImg} 
              alt="شخص يدرس في دمشق" 
              className="w-full h-full object-cover rounded-3xl aspect-[4/3]"
            />
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-foreground mb-4">لماذا "لغتي"؟</h2>
            <p className="text-muted-foreground text-lg">بنينا هذه المنصة لتجاوز العقبات التي تواجه المتعلم في بلدنا، بتكلفة مدروسة ومنهج عملي.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
              <div className="h-14 w-14 rounded-xl bg-amber-100 flex items-center justify-center mb-6">
                <Mic className="h-7 w-7 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold mb-3">ركز على المحادثة</h3>
              <p className="text-muted-foreground leading-relaxed">
                من الدرس الأول وحتى المستوى المتقدم، نركز على قدرتك على صياغة الجمل ونطقها بثقة، لا مجرد قراءتها.
              </p>
            </div>
            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
              <div className="h-14 w-14 rounded-xl bg-teal-100 flex items-center justify-center mb-6">
                <BookOpen className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">منهج متدرج وواضح</h3>
              <p className="text-muted-foreground leading-relaxed">
                من الصفر A1 وحتى الطلاقة C2، دروس قصيرة مركزة تتناسب مع وقتك وتمنحك تقدماً ملموساً كل يوم.
              </p>
            </div>
            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
              <div className="h-14 w-14 rounded-xl bg-amber-100 flex items-center justify-center mb-6">
                <Award className="h-7 w-7 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold mb-3">تكلفة تناسب الجميع</h3>
              <p className="text-muted-foreground leading-relaxed">
                تعلم اللغة لم يعد رفاهية. نوفر اشتراكات رمزية تبدأ من ٢ دولار شهرياً، مع طرق دفع محلية قريباً.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-foreground mb-4">باقات الاشتراك</h2>
            <p className="text-muted-foreground text-lg">اختر الباقة التي تناسب طموحك.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free */}
            <div className="bg-card p-8 rounded-3xl border border-border flex flex-col">
              <h3 className="text-2xl font-bold mb-2">الباقة المجانية</h3>
              <div className="text-4xl font-bold mb-6">$0<span className="text-lg text-muted-foreground font-normal"> / شهرياً</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> <span>الوصول للمستوى الأول A1</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> <span>تمارين القراءة والكتابة</span>
                </li>
              </ul>
              <Link href="/register">
                <Button variant="outline" className="w-full rounded-xl h-12 text-lg">ابدأ الآن</Button>
              </Link>
            </div>
            
            {/* General */}
            <div className="bg-primary text-primary-foreground p-8 rounded-3xl shadow-xl relative transform md:-translate-y-4 flex flex-col">
              <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 bg-amber-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">
                الأكثر طلباً
              </div>
              <h3 className="text-2xl font-bold mb-2 text-white">الإنجليزية العامة</h3>
              <div className="text-4xl font-bold mb-6 text-white">$2<span className="text-lg text-primary-foreground/80 font-normal"> / شهرياً</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-amber-400" /> <span className="text-white">الوصول لجميع المستويات (A1-C2)</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-amber-400" /> <span className="text-white">تمارين المحادثة والاستماع المتقدمة</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-amber-400" /> <span className="text-white">قاموس مفردات غير محدود</span>
                </li>
              </ul>
              <Link href="/register">
                <Button className="w-full rounded-xl h-12 text-lg bg-amber-500 hover:bg-amber-600 text-white">
                  اشترك الآن
                </Button>
              </Link>
            </div>
            
            {/* Pro */}
            <div className="bg-card p-8 rounded-3xl border border-border flex flex-col">
              <h3 className="text-2xl font-bold mb-2">الإنجليزية المهنية</h3>
              <div className="text-4xl font-bold mb-6">$4<span className="text-lg text-muted-foreground font-normal"> / شهرياً</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> <span>كل ميزات الإنجليزية العامة</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> <span>محتوى متخصص ببيئة العمل</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> <span>شريك محادثة تفاعلي</span>
                </li>
              </ul>
              <Link href="/register">
                <Button variant="outline" className="w-full rounded-xl h-12 text-lg">اختر الباقة</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="border-t border-border bg-card py-12 text-center text-muted-foreground">
        <div className="container mx-auto px-4 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-4">
             <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-primary-foreground" />
             </div>
             <span className="font-bold text-xl text-foreground">لغتي</span>
          </div>
          <p className="mb-6">بناء مستقبل أفضل عبر جسور اللغة.</p>
          <p className="text-sm">© {new Date().getFullYear()} Ascension. جميع الحقوق محفوظة.</p>
        </div>
      </footer>
    </div>
  );
}
