/**
 * CMS Lesson Preview — renders a lesson exactly as students see it,
 * clearly labelled "Preview Mode". Never records progress.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cmsApi } from "@/lib/cms-api";
import { CMSLayout } from "@/components/cms-layout";
import { StatusBadge } from "@/components/cms-layout";
import { ArrowLeft, Eye } from "lucide-react";

interface Props { lessonId: number }

export default function LessonPreviewPage({ lessonId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cms-preview", lessonId],
    queryFn: () => cmsApi.lessons.preview(lessonId),
  });

  return (
    <CMSLayout>
      <div className="space-y-4">
        {/* Preview banner */}
        <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-800">
            <Eye className="h-4 w-4" />
            <span className="text-sm font-semibold">Preview Mode</span>
            <span className="text-sm text-amber-600">— not recording student progress or consuming AI credits</span>
          </div>
          <Link href={`/cms/lessons/${lessonId}/edit`}>
            <a className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to editor
            </a>
          </Link>
        </div>

        {isLoading && <div className="py-12 text-center text-gray-400 text-sm">Loading preview…</div>}
        {error && <div className="py-12 text-center text-red-400 text-sm">Failed to load preview</div>}

        {data && (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Lesson header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={(data.lesson as any).status} />
                <span className="text-xs text-gray-400">v{(data.lesson as any).contentVersion}</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{data.lesson.title}</h1>
              {(data.lesson as any).subtitle && (
                <p className="text-gray-600">{(data.lesson as any).subtitle}</p>
              )}
              {data.lesson.description && (
                <p className="text-gray-500 text-sm">{data.lesson.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>{(data.lesson as any).levelCode}</span>
                <span>{data.lesson.estimatedMinutes} min</span>
                <span>{data.lesson.lessonType}</span>
              </div>
            </div>

            {/* Content blocks */}
            {data.contentBlocks.map((block: any, idx: number) => (
              <div key={block.id} className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-mono">#{idx + 1}</span>
                  <span className="capitalize">{block.type.replace("_", " ")}</span>
                  {!block.isRequired && <span className="text-gray-300">(optional)</span>}
                </div>

                {block.title && <h2 className="font-semibold text-gray-800">{block.title}</h2>}
                {block.instructions && <p className="text-sm text-gray-500 italic">{block.instructions}</p>}

                {block.content && (
                  <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {block.content}
                  </div>
                )}

                {block.contentAr && (
                  <div className="text-gray-600 text-sm border-t pt-3 text-right leading-relaxed" dir="rtl">
                    {block.contentAr}
                  </div>
                )}

                {block.type === "vocabulary_list" && data.vocabulary.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {data.vocabulary.map((v: any) => (
                      <div key={v.id} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
                        <div className="font-medium text-gray-800">{v.word}</div>
                        <div className="text-sm text-gray-500">{v.translation}</div>
                        {v.pronunciation && <div className="text-xs text-gray-400 font-mono">{v.pronunciation}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {block.exercise && block.type === "mcq" && (
                  <MCQPreview exercise={block.exercise} options={block.options ?? []} />
                )}

                {block.exercise && block.type === "speaking_prompt" && (
                  <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-4 space-y-2">
                    <p className="text-sm font-medium text-indigo-800">Speaking Activity</p>
                    <p className="text-gray-700">{block.exercise.prompt ?? block.exercise.question}</p>
                    {block.exercise.promptAr && <p dir="rtl" className="text-sm text-gray-500">{block.exercise.promptAr}</p>}
                    {block.exercise.instructionsText && <p className="text-xs text-indigo-600 italic">{block.exercise.instructionsText}</p>}
                  </div>
                )}

                {block.exercise && block.type === "open_ended" && (
                  <div className="space-y-2">
                    <p className="text-gray-700 font-medium">{block.exercise.question}</p>
                    {block.exercise.questionAr && <p dir="rtl" className="text-sm text-gray-500">{block.exercise.questionAr}</p>}
                    <div className="h-24 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-300 italic">
                      Student writes their answer here…
                    </div>
                  </div>
                )}

                {block.type === "pronunciation_guide" && (
                  <div className="space-y-1">
                    {block.prompt && <div className="text-xl font-semibold text-gray-800">{block.prompt}</div>}
                    {block.content && <div className="text-lg font-mono text-gray-500">{block.content}</div>}
                    {block.contentAr && <div dir="rtl" className="text-sm text-gray-500">{block.contentAr}</div>}
                  </div>
                )}

                {block.audioNote && (
                  <div className="text-xs text-gray-400 font-mono bg-gray-50 rounded px-2 py-1">
                    🔊 {block.audioNote}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </CMSLayout>
  );
}

function MCQPreview({ exercise, options }: { exercise: any; options: any[] }) {
  return (
    <div className="space-y-3">
      <p className="font-medium text-gray-800">{exercise.question}</p>
      {exercise.questionAr && <p dir="rtl" className="text-sm text-gray-500">{exercise.questionAr}</p>}
      <div className="space-y-2">
        {options.map((opt: any) => (
          <div key={opt.optionId ?? opt.option_id}
            className={`flex items-center gap-3 rounded border p-2.5 text-sm ${(opt.optionId ?? opt.option_id) === exercise.correctOptionId ? "border-green-300 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-700"}`}>
            <span className="font-mono text-xs text-gray-400">{opt.optionId ?? opt.option_id})</span>
            <span>{opt.text}</span>
            {opt.textAr && <span dir="rtl" className="text-gray-400 ml-auto text-xs">{opt.textAr}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
