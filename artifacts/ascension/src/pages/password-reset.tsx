/**
 * Password recovery: request a link, then set a new password with it.
 *
 * Two screens in one file because they are two halves of one flow and share
 * their API calls. Hand-written fetch rather than generated hooks: these
 * endpoints are not in `openapi.yaml`, the same reason `quiz-api.ts` exists.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Loader2, CheckCircle2, ArrowRight } from "lucide-react";

const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(payload?.error ?? "حدث خطأ، يرجى المحاولة مرة أخرى");
  }
  return payload as T;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-6 cursor-pointer">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <BookOpen className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="font-bold text-3xl text-foreground font-sans">لغتي</span>
        </Link>
        <h2 className="mt-2 text-3xl font-extrabold text-foreground">{title}</h2>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card py-8 px-4 shadow-xl border border-border sm:rounded-3xl sm:px-10 space-y-5">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Request a link ───────────────────────────────────────────────────────────

export function ForgotPassword() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  /** Only returned in development, when no mail provider is configured. */
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const r = await post<{ message: string; devResetLink?: string }>(
        "/auth/forgot-password",
        { email },
      );
      setDevLink(r.devResetLink ?? null);
      setSent(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "تعذر إرسال الرابط",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <Shell title="تحقق من بريدك">
        <div className="flex flex-col items-center text-center gap-3">
          <CheckCircle2 className="h-12 w-12 text-emerald-600" />
          <p className="text-muted-foreground leading-relaxed">
            إذا كان هذا البريد مسجلاً لدينا، فقد أرسلنا إليه رابطاً لإعادة تعيين
            كلمة المرور. الرابط صالح لمدة ساعة واحدة.
          </p>
        </div>

        {devLink && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs space-y-1">
            <p className="font-medium text-amber-800">
              لا يوجد مزوّد بريد مُهيأ — هذا الرابط للتطوير فقط:
            </p>
            <a href={devLink} className="break-all text-amber-700 underline" dir="ltr">
              {devLink}
            </a>
          </div>
        )}

        <Link href="/login">
          <Button variant="outline" className="w-full">العودة لتسجيل الدخول</Button>
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="نسيت كلمة المرور">
      <p className="text-sm text-muted-foreground leading-relaxed">
        أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>البريد الإلكتروني</Label>
          <Input
            type="email"
            required
            dir="ltr"
            className="text-left"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full h-12 text-lg rounded-xl" disabled={pending}>
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "إرسال الرابط"}
        </Button>
      </form>
      <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">
        العودة لتسجيل الدخول
      </Link>
    </Shell>
  );
}

// ─── Set a new password ───────────────────────────────────────────────────────

export function ResetPassword() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  // wouter's useSearch is not used elsewhere in this app; read it directly.
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ variant: "destructive", title: "كلمتا المرور غير متطابقتين" });
      return;
    }
    setPending(true);
    try {
      await post("/auth/reset-password", { token, password });
      toast({ title: "تم تغيير كلمة المرور", description: "يمكنك الآن تسجيل الدخول." });
      setLocation("/login");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "تعذر تغيير كلمة المرور",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <Shell title="رابط غير صالح">
        <p className="text-sm text-muted-foreground leading-relaxed">
          هذا الرابط غير مكتمل. اطلب رابطاً جديداً لإعادة تعيين كلمة المرور.
        </p>
        <Link href="/forgot-password">
          <Button className="w-full">
            طلب رابط جديد <ArrowRight className="h-4 w-4 mr-1" />
          </Button>
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="كلمة مرور جديدة">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>كلمة المرور الجديدة</Label>
          <Input
            type="password"
            required
            minLength={8}
            dir="ltr"
            className="text-left"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            ٨ محارف على الأقل، وتحتوي على حرف ورقم.
          </p>
        </div>
        <div className="space-y-2">
          <Label>تأكيد كلمة المرور</Label>
          <Input
            type="password"
            required
            dir="ltr"
            className="text-left"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full h-12 text-lg rounded-xl" disabled={pending}>
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "تغيير كلمة المرور"}
        </Button>
      </form>
    </Shell>
  );
}
