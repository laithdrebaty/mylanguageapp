/**
 * Voice-practice reports: the queue where a complaint about another student is
 * answered by a person.
 *
 * The most important thing on this screen is the thing it does not have. Practice
 * calls are peer-to-peer and are not recorded, so there is no audio to listen
 * to. What is shown instead is everything that is actually known — who, when,
 * how long the call ran, how it ended, and how many other people have reported
 * or blocked the same student — and the banner says plainly that this is all
 * there is. An administrator who believes they have evidence they do not have
 * will act with confidence they have not earned.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CMSLayout } from "@/components/cms-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert, Info } from "lucide-react";

const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

interface ReportRow {
  id: number;
  reason: string;
  detail: string | null;
  status: "open" | "reviewed" | "actioned";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewerName: string | null;
  reporterId: number;
  reporterName: string;
  reportedId: number;
  reportedName: string;
  reportedEmail: string;
  sessionId: number | null;
  sessionStartedAt: string | null;
  sessionDurationSeconds: number | null;
  sessionEndReason: string | null;
  totalReportsAgainst: number;
  totalBlocksAgainst: number;
}

interface QueueResponse {
  items: ReportRow[];
  counts: { open: number };
  evidenceNote: string;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let message = `${method} ${path} → ${r.status}`;
    try {
      const e = await r.json();
      message = e.error ?? message;
    } catch {
      /* status is all there is */
    }
    throw new Error(message);
  }
  return r.json();
}

const REASON_LABEL: Record<string, string> = {
  harassment: "Harassment or abuse",
  inappropriate: "Inappropriate content",
  spam: "Spam or advertising",
  language: "Unsuitable language",
  other: "Other",
};

const END_REASON_LABEL: Record<string, string> = {
  ended_by_user: "one side hung up",
  blocked: "ended by a block",
  timeout: "hit the maximum call length",
  not_answered: "never answered",
  connection_failed: "could not connect",
  declined: "declined",
};

function waitedFor(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

export default function PracticeReports() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "all">("open");
  const [notes, setNotes] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["cms-practice-reports", status],
    queryFn: () => api<QueueResponse>("GET", `/cms/practice/reports?status=${status}`),
  });

  const reviewMut = useMutation({
    mutationFn: (input: { id: number; status: "reviewed" | "actioned"; note?: string }) =>
      api("POST", `/cms/practice/reports/${input.id}/review`, {
        status: input.status,
        note: input.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cms-practice-reports"] });
      toast({ title: "Report closed" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const items = data?.items ?? [];

  return (
    <CMSLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Practice Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Complaints from students about the person they were matched with for voice
            practice.
          </p>
        </div>

        {/* Stated before the list, not after it: it changes how everything below
            should be read. */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            {data?.evidenceNote ??
              "Practice calls are peer-to-peer and are not recorded. There is no audio for any report."}{" "}
            Judge a single report on what the reporter wrote; judge a student on the pattern
            across reports.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Open reports" value={data?.counts.open ?? 0} emphasis />
          <Stat label="Shown" value={items.length} />
        </div>

        <div className="flex items-center gap-2">
          {(["open", "all"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`text-xs px-2.5 py-1 rounded-md border capitalize ${
                status === value
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 p-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center p-12 border border-dashed border-gray-200 rounded-lg">
            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Nothing waiting.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-red-500" />
                      <span className="font-semibold text-gray-900">
                        {item.reportedName}
                      </span>
                      <span className="text-xs text-gray-500">{item.reportedEmail}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Reported by {item.reporterName} · {waitedFor(item.createdAt)} ago ·{" "}
                      {REASON_LABEL[item.reason] ?? item.reason}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <Badge
                      label={`${item.totalReportsAgainst} report${
                        item.totalReportsAgainst === 1 ? "" : "s"
                      }`}
                      alarming={item.totalReportsAgainst > 2}
                    />
                    <Badge
                      label={`${item.totalBlocksAgainst} block${
                        item.totalBlocksAgainst === 1 ? "" : "s"
                      }`}
                      alarming={item.totalBlocksAgainst > 2}
                    />
                  </div>
                </div>

                {item.detail ? (
                  <p className="text-sm text-gray-800 bg-gray-50 rounded-md p-3 whitespace-pre-wrap">
                    {item.detail}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    The reporter did not write anything.
                  </p>
                )}

                <p className="text-xs text-gray-500">
                  {item.sessionId === null ? (
                    "No call is linked to this report."
                  ) : (
                    <>
                      Call #{item.sessionId}
                      {item.sessionStartedAt &&
                        ` started ${new Date(item.sessionStartedAt).toLocaleString()}`}
                      {item.sessionDurationSeconds !== null &&
                        `, lasted ${item.sessionDurationSeconds}s`}
                      {item.sessionEndReason &&
                        `, ${END_REASON_LABEL[item.sessionEndReason] ?? item.sessionEndReason}`}
                      .
                    </>
                  )}
                </p>

                {item.status === "open" ? (
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    <Textarea
                      rows={2}
                      placeholder="What did you do about it? (kept with the report)"
                      value={notes[item.id] ?? ""}
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [item.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={reviewMut.isPending}
                        onClick={() =>
                          reviewMut.mutate({
                            id: item.id,
                            status: "actioned",
                            note: notes[item.id],
                          })
                        }
                      >
                        Acted on it
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reviewMut.isPending}
                        onClick={() =>
                          reviewMut.mutate({
                            id: item.id,
                            status: "reviewed",
                            note: notes[item.id],
                          })
                        }
                      >
                        Looked at it, nothing to do
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                    {item.status === "actioned" ? "Acted on" : "Reviewed"} by{" "}
                    {item.reviewerName ?? "—"}
                    {item.reviewedAt && ` on ${new Date(item.reviewedAt).toLocaleString()}`}
                    {item.reviewNote && ` — ${item.reviewNote}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </CMSLayout>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        emphasis && value > 0 ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900 flex items-center gap-1.5">
        {emphasis && value > 0 && <AlertCircle className="h-4 w-4 text-red-500" />}
        {value}
      </div>
    </div>
  );
}

function Badge({ label, alarming }: { label: string; alarming: boolean }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded font-medium ${
        alarming ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"
      }`}
    >
      {label}
    </span>
  );
}
