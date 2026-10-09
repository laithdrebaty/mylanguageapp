/**
 * Free-form multi-value tag entry, backed by a Postgres text[].
 *
 * Vocabulary could only ever be filed under one category, even though
 * `vocabulary.tags` has always been an array — a word like "invoice" belongs
 * under both "business" and "finance" and had to be forced into one.
 */
import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

export function TagsInput({
  value,
  onChange,
  label = "Categories",
  placeholder = "Type and press Enter",
  suggestions = [],
  disabled = false,
}: {
  value?: string[] | null;
  onChange: (next: string[]) => void;
  label?: string;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const tags = value ?? [];

  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    // Case-insensitive de-dupe keeps "Business" and "business" from both existing.
    if (!tag || tags.some((t) => t.toLowerCase() === tag)) return;
    onChange([...tags, tag]);
    setDraft("");
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      remove(tags[tags.length - 1]);
    }
  };

  const unused = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-1">
      {label && <Label className="text-xs text-gray-500">{label}</Label>}

      <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background p-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
          >
            {tag}
            {!disabled && (
              <button type="button" onClick={() => remove(tag)} className="hover:text-indigo-900">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <Input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="h-6 flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>

      {!disabled && unused.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {unused.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
