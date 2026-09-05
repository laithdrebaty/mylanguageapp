/**
 * Voice practice with another learner (spec section 11).
 *
 * The screen has five states and each one has to be honest about something:
 *
 *   preferences  Opting in is a decision, so it is made once, deliberately,
 *                next to the sentence explaining that calls are live, with a
 *                stranger, and not recorded.
 *   searching    An empty pool is normal in a small product. It says "nobody is
 *                available right now", not "error".
 *   ringing      Both people see who they were matched with and why, and either
 *                can say no without explaining.
 *   in call      Ending is one tap with no confirmation. Blocking and reporting
 *                are on this screen, not buried in a menu afterwards, because
 *                someone who needs to report something wants out now.
 *   failed       Without a TURN relay some calls cannot connect at all. The
 *                screen says that plainly instead of spinning forever.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  practiceApi,
  PracticeError,
  type PracticePreferences,
  type PracticeSessionView,
  type ReportReason,
} from "@/lib/practice-api";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Loader2,
  ShieldAlert,
  Ban,
  Users,
  Info,
  X,
} from "lucide-react";

const POLL_MS = 1000;

const REASON_LABELS: Record<ReportReason, string> = {
  harassment: "مضايقة أو إساءة",
  inappropriate: "محتوى غير لائق",
  spam: "إعلانات أو رسائل مزعجة",
  language: "لغة غير مناسبة",
  other: "سبب آخر",
};

const EMPTY_PREFERENCES: PracticePreferences = {
  isAvailable: false,
  goals: [],
  interests: [],
  professionalField: null,
  availableHours: [],
};

/** Comma-separated text ↔ tag list, the simplest input that fits both languages. */
const toTags = (text: string) =>
  text
    .split(/[,،]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);

const fromTags = (tags: string[]) => tags.join("، ");

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Practice() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["practice-profile"],
    queryFn: () => practiceApi.getProfile(),
  });

  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState<PracticeSessionView | null>(null);
  const [queued, setQueued] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [secondsWaiting, setSecondsWaiting] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);

  const call = useVoiceCall();
  const startedForRef = useRef<number | null>(null);

  const profile = data?.profile ?? null;
  const limits = data?.limits;
  const optedIn = profile?.isAvailable === true;

  // ─── Polling ───────────────────────────────────────────────────────────────
  //
  // One timer covers both waiting for a partner and being in a call: the same
  // endpoint refreshes presence, delivers the pairing, and reports when the
  // other side has hung up.

  const shouldPoll = queued || session !== null;

  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const status = await practiceApi.poll();
        if (cancelled) return;
        setSession(status.session);
        setQueued(status.queued);
        setWaiting(status.waiting);
        setSecondsWaiting(status.secondsWaiting);
      } catch {
        // A dropped poll is not a dropped call; the next one catches up.
      }
    };

    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [shouldPoll]);

  // The call itself starts once, when the session becomes active on both sides.
  useEffect(() => {
    if (session?.status === "active" && startedForRef.current !== session.sessionId) {
      startedForRef.current = session.sessionId;
      void call.start({ sessionId: session.sessionId, isCaller: session.isCaller });
    }
    if (session === null || session.status === "ended" || session.status === "declined") {
      if (startedForRef.current !== null) {
        startedForRef.current = null;
        call.reset();
      }
    }
  }, [session, call]);

  // A call the server has ended is over here too, whatever the peer connection
  // still thinks.
  useEffect(() => {
    if (!session || session.status !== "active") {
      setElapsed(0);
      return;
    }
    const started = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  // Telling the server the connection could not be established is what turns a
  // failed call into a finished one, rather than a ghost that blocks the next.
  useEffect(() => {
    if (call.phase === "failed" && session && session.status === "active") {
      void practiceApi.end(session.sessionId, "connection_failed").catch(() => {});
    }
  }, [call.phase, session]);

  const fail = useCallback(
    (err: unknown) => {
      const message =
        err instanceof PracticeError ? err.message : "حدث خطأ. حاول مرة أخرى.";
      toast({ title: "تعذّر إتمام العملية", description: message, variant: "destructive" });
    },
    [toast],
  );

  // ─── Actions ───────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: (prefs: PracticePreferences) => practiceApi.saveProfile(prefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["practice-profile"] });
      setEditing(false);
      toast({ title: "تم حفظ تفضيلاتك" });
    },
    onError: fail,
  });

  const searchMut = useMutation({
    mutationFn: () => practiceApi.joinQueue(),
    onSuccess: (r) => {
      setSession(r.session);
      setWaiting(r.waiting);
      setQueued(r.session === null);
    },
    onError: fail,
  });

  const stopSearch = async () => {
    setQueued(false);
    await practiceApi.leaveQueue().catch(() => {});
  };

  const acceptMut = useMutation({
    mutationFn: (id: number) => practiceApi.accept(id),
    onSuccess: (r) => setSession(r.session),
    onError: (err) => {
      setSession(null);
      fail(err);
    },
  });

  /** Immediate and unilateral. The peer connection closes before the request. */
  const endCall = (reason: "ended_by_user" | "declined" = "ended_by_user") => {
    const id = session?.sessionId;
    call.hangUp();
    setSession(null);
    setQueued(false);
    if (id !== undefined) void practiceApi.end(id, reason).catch(() => {});
  };

  const blockPartner = async () => {
    if (!session) return;
    const { userId } = session.partner;
    const sessionId = session.sessionId;
    call.hangUp();
    setSession(null);
    setQueued(false);
    try {
      await practiceApi.block(userId, sessionId);
      toast({
        title: "تم الحظر",
        description: "لن يتم إقرانك بهذا الشخص مرة أخرى.",
      });
    } catch (err) {
      fail(err);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-10 w-56 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const inCall = session?.status === "active";
  const ringing = session?.status === "waiting";

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <audio ref={call.audioRef} autoPlay playsInline className="hidden" />

      <header>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Mic className="h-8 w-8 text-primary" />
          التدريب الصوتي مع متعلّم آخر
        </h1>
        <p className="text-muted-foreground mt-2">
          محادثة صوتية مباشرة مع طالب آخر في مستواك تقريبًا. هذه ليست محادثة مع الذكاء
          الاصطناعي — الشخص على الطرف الآخر متعلّم مثلك.
        </p>
      </header>

      {/* The one thing every student must know before opting in, kept on the page
          rather than in a dialog they can dismiss without reading. */}
      <PrivacyNotice />

      {ringing && session && (
        <RingingCard
          session={session}
          onAccept={() => acceptMut.mutate(session.sessionId)}
          onDecline={() => endCall("declined")}
          accepting={acceptMut.isPending}
        />
      )}

      {inCall && session && (
        <CallCard
          session={session}
          phase={call.phase}
          muted={call.muted}
          turnAvailable={call.turnAvailable}
          elapsed={elapsed}
          secondsRemaining={session.secondsRemaining}
          onToggleMute={call.toggleMute}
          onEnd={() => endCall()}
          onBlock={blockPartner}
          onReport={() => setReportOpen(true)}
        />
      )}

      {!ringing && !inCall && (
        <>
          {!optedIn || editing ? (
            <PreferencesForm
              initial={profile ?? EMPTY_PREFERENCES}
              saving={saveMut.isPending}
              onCancel={optedIn ? () => setEditing(false) : undefined}
              onSave={(prefs) => saveMut.mutate(prefs)}
            />
          ) : queued ? (
            <SearchingCard
              waiting={waiting}
              secondsWaiting={secondsWaiting}
              onCancel={stopSearch}
            />
          ) : (
            <ReadyCard
              profile={profile!}
              maxMinutes={limits?.maxCallMinutes ?? 30}
              searching={searchMut.isPending}
              onSearch={() => searchMut.mutate()}
              onEdit={() => setEditing(true)}
            />
          )}
        </>
      )}

      {session && (
        <ReportDialog
          open={reportOpen}
          partnerName={session.partner.name}
          onClose={() => setReportOpen(false)}
          onSubmit={async (reason, detail, alsoBlock) => {
            const partnerId = session.partner.userId;
            const sessionId = session.sessionId;
            call.hangUp();
            setSession(null);
            setReportOpen(false);
            try {
              await practiceApi.report({
                userId: partnerId,
                sessionId,
                reason,
                detail,
                alsoBlock,
              });
              toast({
                title: "تم إرسال البلاغ",
                description: "سيراجعه فريق الإشراف. شكرًا لإبلاغنا.",
              });
            } catch (err) {
              fail(err);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function PrivacyNotice() {
  return (
    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1.5">
      <div className="flex items-center gap-2 font-bold">
        <Info className="h-4 w-4" />
        قبل أن تبدأ
      </div>
      <ul className="list-disc pr-5 space-y-1 leading-relaxed">
        <li>المكالمة مباشرة بينك وبين الطالب الآخر، ولا يتم تسجيلها ولا حفظ أي صوت منها.</li>
        <li>
          لأنّ المكالمة غير مسجّلة، لا يستطيع فريق الإشراف الاستماع إلى ما حدث. البلاغ يعتمد
          على ما تكتبه أنت.
        </li>
        <li>يمكنك إنهاء المكالمة في أي لحظة، وحظر الشخص أو الإبلاغ عنه أثناء المكالمة نفسها.</li>
        <li>لا تشارك اسمك الكامل أو رقم هاتفك أو أي معلومات شخصية.</li>
      </ul>
    </div>
  );
}

function PreferencesForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: PracticePreferences;
  saving: boolean;
  onSave: (prefs: PracticePreferences) => void;
  onCancel?: () => void;
}) {
  const [goals, setGoals] = useState(fromTags(initial.goals));
  const [interests, setInterests] = useState(fromTags(initial.interests));
  const [field, setField] = useState(initial.professionalField ?? "");
  const [hours, setHours] = useState<number[]>(initial.availableHours);
  const [agreed, setAgreed] = useState(initial.isAvailable);

  const toggleHour = (hour: number) =>
    setHours((current) =>
      current.includes(hour) ? current.filter((h) => h !== hour) : [...current, hour],
    );

  return (
    <Card className="border-2 border-border">
      <CardContent className="p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold">تفضيلات التدريب</h2>
          <p className="text-sm text-muted-foreground mt-1">
            نستخدم هذه المعلومات لإيجاد شريك قريب من مستواك ولديه ما يتحدث معك عنه.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="interests">اهتماماتك</Label>
          <Input
            id="interests"
            placeholder="كرة القدم، الطبخ، السفر"
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">افصل بينها بفاصلة. حتى ١٠ اهتمامات.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="goals">أهدافك من تعلّم الإنجليزية</Label>
          <Input
            id="goals"
            placeholder="السفر، العمل، الدراسة"
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="field">مجال عملك أو دراستك</Label>
          <Input
            id="field"
            placeholder="الطب، الهندسة، التجارة"
            value={field}
            onChange={(e) => setField(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>الأوقات التي تكون متاحًا فيها عادةً</Label>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5" dir="ltr">
            {Array.from({ length: 24 }, (_, hour) => (
              <button
                key={hour}
                type="button"
                onClick={() => toggleHour(hour)}
                className={`h-9 rounded-md text-xs border transition-colors ${
                  hours.includes(hour)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-secondary"
                }`}
              >
                {String(hour).padStart(2, "0")}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            بتوقيت UTC. اختياري — يُستخدم فقط لترجيح من يشبه جدولك.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-border p-4">
          <Switch id="opt-in" checked={agreed} onCheckedChange={setAgreed} />
          <Label htmlFor="opt-in" className="text-sm leading-relaxed cursor-pointer">
            أوافق على التحدث صوتيًا مع متعلّمين آخرين، وأفهم أنّ المكالمة مباشرة وغير مسجّلة،
            وأنّ بإمكاني إنهاءها أو حظر الطرف الآخر في أي وقت.
          </Label>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() =>
              onSave({
                isAvailable: agreed,
                goals: toTags(goals),
                interests: toTags(interests),
                professionalField: field.trim() || null,
                availableHours: hours,
              })
            }
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
            حفظ
          </Button>
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              إلغاء
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReadyCard({
  profile,
  maxMinutes,
  searching,
  onSearch,
  onEdit,
}: {
  profile: PracticePreferences;
  maxMinutes: number;
  searching: boolean;
  onSearch: () => void;
  onEdit: () => void;
}) {
  return (
    <Card className="border-2 border-border">
      <CardContent className="p-8 text-center space-y-5">
        <div className="mx-auto h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Users className="h-10 w-10 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">جاهز للتحدث؟</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            سنبحث عن طالب في مستواك تقريبًا ويشاركك بعض الاهتمامات. أقصى مدة للمكالمة{" "}
            {maxMinutes} دقيقة.
          </p>
        </div>
        <Button size="lg" className="h-12 px-8 rounded-xl" onClick={onSearch} disabled={searching}>
          {searching ? (
            <Loader2 className="h-5 w-5 ml-2 animate-spin" />
          ) : (
            <Phone className="h-5 w-5 ml-2" />
          )}
          ابحث عن شريك
        </Button>
        <div className="pt-2 text-xs text-muted-foreground">
          {profile.interests.length > 0 && <span>اهتماماتك: {fromTags(profile.interests)}</span>}
          <button onClick={onEdit} className="underline mr-3 hover:text-foreground">
            تعديل التفضيلات
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function SearchingCard({
  waiting,
  secondsWaiting,
  onCancel,
}: {
  waiting: number;
  secondsWaiting: number;
  onCancel: () => void;
}) {
  return (
    <Card className="border-2 border-primary/30">
      <CardContent className="p-8 text-center space-y-5">
        <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
        <div>
          <h2 className="text-xl font-bold">نبحث عن شريك…</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {waiting > 0
              ? `${waiting} متعلّم آخر في قائمة الانتظار الآن.`
              : "لا يوجد أحد متاح في هذه اللحظة. سنقرنك بأول من ينضم."}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            وقت الانتظار: {mmss(secondsWaiting)}
          </p>
        </div>
        <Button variant="outline" onClick={onCancel}>
          <X className="h-4 w-4 ml-2" />
          إيقاف البحث
        </Button>
      </CardContent>
    </Card>
  );
}

function RingingCard({
  session,
  onAccept,
  onDecline,
  accepting,
}: {
  session: PracticeSessionView;
  onAccept: () => void;
  onDecline: () => void;
  accepting: boolean;
}) {
  return (
    <Card className="border-2 border-primary">
      <CardContent className="p-8 text-center space-y-5">
        <div className="mx-auto h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
          <Phone className="h-10 w-10 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">وجدنا لك شريكًا</h2>
          <p className="text-2xl font-bold text-primary mt-2">{session.partner.name}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {session.partner.levelCode && <span dir="ltr">{session.partner.levelCode}</span>}
            {session.partner.interests.length > 0 && (
              <span> · {fromTags(session.partner.interests.slice(0, 3))}</span>
            )}
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <Button size="lg" className="rounded-xl" onClick={onAccept} disabled={accepting}>
            {accepting ? (
              <Loader2 className="h-5 w-5 ml-2 animate-spin" />
            ) : (
              <Phone className="h-5 w-5 ml-2" />
            )}
            ابدأ المكالمة
          </Button>
          <Button size="lg" variant="outline" className="rounded-xl" onClick={onDecline}>
            رفض
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          رفض المكالمة لا يُبلّغ الطرف الآخر بشيء.
        </p>
      </CardContent>
    </Card>
  );
}

function CallCard({
  session,
  phase,
  muted,
  turnAvailable,
  elapsed,
  secondsRemaining,
  onToggleMute,
  onEnd,
  onBlock,
  onReport,
}: {
  session: PracticeSessionView;
  phase: string;
  muted: boolean;
  turnAvailable: boolean;
  elapsed: number;
  secondsRemaining: number | null;
  onToggleMute: () => void;
  onEnd: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  return (
    <Card className="border-2 border-primary">
      <CardContent className="p-8 space-y-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">تتحدث الآن مع</p>
          <p className="text-2xl font-bold">{session.partner.name}</p>
          {phase === "connected" && (
            <p className="text-lg font-mono text-primary" dir="ltr">
              {mmss(elapsed)}
            </p>
          )}
          {secondsRemaining !== null && secondsRemaining < 120 && phase === "connected" && (
            <p className="text-xs text-amber-700">
              ستنتهي المكالمة تلقائيًا خلال {mmss(secondsRemaining)}
            </p>
          )}
        </div>

        <CallPhaseNotice phase={phase} turnAvailable={turnAvailable} />

        <div className="flex flex-wrap gap-3 justify-center">
          <Button
            variant={muted ? "default" : "outline"}
            size="lg"
            className="rounded-xl"
            onClick={onToggleMute}
            disabled={phase !== "connected"}
          >
            {muted ? <MicOff className="h-5 w-5 ml-2" /> : <Mic className="h-5 w-5 ml-2" />}
            {muted ? "الميكروفون مغلق" : "كتم الصوت"}
          </Button>

          {/* No confirmation dialog, deliberately: someone who needs to get out
              of a conversation should not be asked whether they are sure. */}
          <Button size="lg" variant="destructive" className="rounded-xl" onClick={onEnd}>
            <PhoneOff className="h-5 w-5 ml-2" />
            إنهاء المكالمة
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 justify-center border-t border-border pt-4">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onReport}>
            <ShieldAlert className="h-4 w-4 ml-1.5" />
            إبلاغ عن هذا الشخص
          </Button>
          <Button variant="ghost" size="sm" onClick={onBlock}>
            <Ban className="h-4 w-4 ml-1.5" />
            حظر ومنع الإقران مجددًا
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The honest half of the call screen.
 *
 * "failed" is not a bug report, it is the expected outcome for roughly one pair
 * in five while the deployment has no TURN relay, and it says so.
 */
function CallPhaseNotice({ phase, turnAvailable }: { phase: string; turnAvailable: boolean }) {
  if (phase === "requesting-mic") {
    return (
      <p className="text-center text-sm text-muted-foreground">
        اسمح للمتصفح باستخدام الميكروفون للمتابعة…
      </p>
    );
  }

  if (phase === "mic-denied") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-center">
        لم نتمكّن من الوصول إلى الميكروفون. افتح إعدادات المتصفح واسمح باستخدام الميكروفون لهذا
        الموقع، ثم حاول مرة أخرى.
      </div>
    );
  }

  if (phase === "connecting") {
    return (
      <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        جارٍ الاتصال…
      </p>
    );
  }

  if (phase === "failed") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-2">
        <p className="font-bold">تعذّر إنشاء الاتصال الصوتي</p>
        <p className="leading-relaxed">
          لم تتمكن المكالمة من الوصول إلى الطرف الآخر. هذا يحدث عادةً بسبب نوع الشبكة (شبكات
          الجوال أو شبكات الشركات)، وليس خطأً في حسابك أو في التطبيق.
          {!turnAvailable && " النظام لا يستخدم خادم ترحيل حاليًا، لذلك بعض الشبكات لا تنجح."}
        </p>
        <p className="leading-relaxed">
          جرّب شبكة أخرى (مثلاً Wi-Fi بدل بيانات الجوال)، أو ابحث عن شريك آخر.
        </p>
      </div>
    );
  }

  return null;
}

function ReportDialog({
  open,
  partnerName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  partnerName: string;
  onClose: () => void;
  onSubmit: (reason: ReportReason, detail: string | null, alsoBlock: boolean) => void;
}) {
  const [reason, setReason] = useState<ReportReason>("inappropriate");
  const [detail, setDetail] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>الإبلاغ عن {partnerName}</DialogTitle>
          <DialogDescription>
            سيصل البلاغ إلى فريق الإشراف. المكالمات غير مسجّلة، لذلك ما تكتبه هنا هو كل ما
            سيعتمدون عليه — اذكر ما حدث بوضوح.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>سبب البلاغ</Label>
            <div className="grid gap-1.5">
              {(Object.keys(REASON_LABELS) as ReportReason[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(key)}
                  className={`text-right px-3 py-2 rounded-lg border text-sm transition-colors ${
                    reason === key
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  {REASON_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="detail">ماذا حدث؟</Label>
            <Textarea
              id="detail"
              rows={4}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="اكتب ما حدث بأكبر قدر من التفصيل."
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="also-block" checked={alsoBlock} onCheckedChange={setAlsoBlock} />
            <Label htmlFor="also-block" className="text-sm cursor-pointer">
              احظر هذا الشخص أيضًا حتى لا يتم إقراني به مجددًا
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="destructive"
            onClick={() => onSubmit(reason, detail.trim() || null, alsoBlock)}
          >
            إرسال البلاغ وإنهاء المكالمة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
