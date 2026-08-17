import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cmsApi } from "@/lib/cms-api";
import { CMSLayout } from "@/components/cms-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ACTIONS = ["create", "update", "publish", "unpublish", "archive", "restore", "delete", "duplicate", "submit_review", "approve", "reject"];
const CONTENT_TYPES = ["lesson", "content_block", "exercise", "vocabulary", "language", "curriculum", "level", "media"];

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [contentType, setContentType] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["cms-audit", page, action, contentType],
    queryFn: () => cmsApi.audit.list({
      page, limit: 50,
      action: action || undefined,
      contentType: contentType || undefined,
    }),
    placeholderData: (prev: any) => prev,
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  const actionColor = (a: string) => {
    if (a === "publish") return "text-green-700 bg-green-50";
    if (a === "delete" || a === "archive") return "text-red-600 bg-red-50";
    if (a === "approve") return "text-blue-700 bg-blue-50";
    if (a === "reject") return "text-orange-700 bg-orange-50";
    return "text-gray-600 bg-gray-100";
  };

  return (
    <CMSLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data?.total ?? "—"} total events</p>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={action} onValueChange={v => { setAction(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="text-sm w-40"><SelectValue placeholder="All actions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTIONS.map(a => <SelectItem key={a} value={a} className="capitalize">{a.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={contentType} onValueChange={v => { setContentType(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="text-sm w-40"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {CONTENT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
          ) : !data?.logs.length ? (
            <div className="p-6 text-center text-gray-400 text-sm">No audit events found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">User</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Action</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Content</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-700 font-medium text-xs">{log.user_name}</div>
                      <div className="text-gray-400 text-xs">{log.user_email}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${actionColor(log.action)}`}>
                        {log.action.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      <span className="capitalize">{log.content_type?.replace("_", " ")}</span>
                      {log.content_id && <span className="text-gray-400"> #{log.content_id}</span>}
                      {log.meta?.title && <div className="text-gray-400 truncate max-w-xs">{log.meta.title}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {log.prev_status && log.new_status && (
                        <span>{log.prev_status} → {log.new_status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </CMSLayout>
  );
}
