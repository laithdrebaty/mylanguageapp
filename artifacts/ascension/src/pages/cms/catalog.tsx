/**
 * Languages, Curricula, and Levels management pages.
 * Rendered based on the `section` prop passed from routing.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cmsApi } from "@/lib/cms-api";
import { CMSLayout } from "@/components/cms-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Check, X } from "lucide-react";

// ─── Languages ────────────────────────────────────────────────────────────

export function LanguagesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: languages, isLoading } = useQuery({ queryKey: ["cms-languages"], queryFn: () => cmsApi.languages.list() });
  const [form, setForm] = useState({ code: "", name: "", nameNative: "", rtl: false, isActive: true });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const createMut = useMutation({
    mutationFn: () => cmsApi.languages.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cms-languages"] }); setForm({ code: "", name: "", nameNative: "", rtl: false, isActive: true }); toast({ title: "Language created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => cmsApi.languages.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cms-languages"] }); setEditId(null); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CMSLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Languages</h1>

        {/* Create form */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Add Language</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">ISO Code *</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="en, ar, fr…" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">English Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Native Name *</Label>
              <Input value={form.nameNative} onChange={e => setForm(f => ({ ...f, nameNative: e.target.value }))} className="text-sm" />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer pb-1">
                <input type="checkbox" checked={form.rtl} onChange={e => setForm(f => ({ ...f, rtl: e.target.checked }))} />
                RTL
              </label>
              <Button size="sm" onClick={() => createMut.mutate()} disabled={!form.code || !form.name || !form.nameNative}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {isLoading ? <div className="p-6 text-center text-gray-400 text-sm">Loading…</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Code</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Native</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">RTL</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Active</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(languages ?? []).map((l: any) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    {editId === l.id ? (
                      <>
                        <td className="px-4 py-2"><Input value={editForm.code} onChange={e => setEditForm((f: any) => ({ ...f, code: e.target.value }))} className="text-sm h-7 w-20" /></td>
                        <td className="px-4 py-2"><Input value={editForm.name} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} className="text-sm h-7" /></td>
                        <td className="px-4 py-2"><Input value={editForm.nameNative} onChange={e => setEditForm((f: any) => ({ ...f, nameNative: e.target.value }))} className="text-sm h-7" /></td>
                        <td className="px-4 py-2"><input type="checkbox" checked={editForm.rtl} onChange={e => setEditForm((f: any) => ({ ...f, rtl: e.target.checked }))} /></td>
                        <td className="px-4 py-2"><input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm((f: any) => ({ ...f, isActive: e.target.checked }))} /></td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => updateMut.mutate({ id: l.id, data: editForm })} className="p-1 rounded hover:bg-green-50 text-green-600"><Check className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setEditId(null)} className="p-1 rounded hover:bg-red-50 text-red-400 ml-1"><X className="h-3.5 w-3.5" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 font-mono text-gray-700">{l.code}</td>
                        <td className="px-4 py-2.5 text-gray-700">{l.name}</td>
                        <td className="px-4 py-2.5">{l.nameNative}</td>
                        <td className="px-4 py-2.5">{l.rtl ? "✓" : "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${l.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {l.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => { setEditId(l.id); setEditForm({ code: l.code, name: l.name, nameNative: l.nameNative, rtl: l.rtl, isActive: l.isActive }); }} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Pencil className="h-3.5 w-3.5" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </CMSLayout>
  );
}

// ─── Curricula ─────────────────────────────────────────────────────────────

export function CurriculaPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: curricula, isLoading } = useQuery({ queryKey: ["cms-curricula"], queryFn: () => cmsApi.curricula.list() });
  const { data: languages } = useQuery({ queryKey: ["cms-languages"], queryFn: () => cmsApi.languages.list() });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ levelFramework: "custom", isActive: true });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const createMut = useMutation({
    mutationFn: () => cmsApi.curricula.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cms-curricula"] }); setForm({ levelFramework: "custom", isActive: true }); setShowForm(false); toast({ title: "Curriculum created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => cmsApi.curricula.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cms-curricula"] }); setEditId(null); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const langOptions = (languages ?? []).map((l: any) => <SelectItem key={l.code} value={l.code}>{l.name} ({l.code})</SelectItem>);

  return (
    <CMSLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Curricula</h1>
          <Button size="sm" onClick={() => setShowForm(f => !f)}><Plus className="h-3.5 w-3.5 mr-1" /> New Curriculum</Button>
        </div>

        {showForm && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">New Curriculum</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Target Language *</Label>
                <Select value={form.targetLanguageCode ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, targetLanguageCode: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Language being learned" /></SelectTrigger>
                  <SelectContent>{langOptions}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Learner Language *</Label>
                <Select value={form.learnerLanguageCode ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, learnerLanguageCode: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Student's native language" /></SelectTrigger>
                  <SelectContent>{langOptions}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Name (English) *</Label>
                <Input value={form.name ?? ""} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Name (Learner Language) *</Label>
                <Input value={form.nameInLearnerLanguage ?? ""} onChange={e => setForm((f: any) => ({ ...f, nameInLearnerLanguage: e.target.value }))} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Level Framework</Label>
                <Select value={form.levelFramework ?? "custom"} onValueChange={v => setForm((f: any) => ({ ...f, levelFramework: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["CEFR", "CEFR_subdivided", "HSK", "JLPT", "custom"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Description</Label>
                <Input value={form.description ?? ""} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} className="text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()}>Create</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {isLoading ? <div className="p-6 text-center text-gray-400 text-sm">Loading…</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">ID</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Languages</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Framework</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Active</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(curricula ?? []).map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-400">{c.id}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-700">{c.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{c.targetLanguageCode} ← {c.learnerLanguageCode}</td>
                    <td className="px-4 py-2.5 text-gray-500">{c.levelFramework}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${c.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {c.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => { setEditId(c.id); setEditForm({ name: c.name, nameInLearnerLanguage: c.nameInLearnerLanguage, levelFramework: c.levelFramework, description: c.description, isActive: c.isActive }); }}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500"><Pencil className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {editId && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Edit Curriculum #{editId}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Name (English)</Label>
                <Input value={editForm.name ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Name (Learner Language)</Label>
                <Input value={editForm.nameInLearnerLanguage ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, nameInLearnerLanguage: e.target.value }))} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Description</Label>
                <Input value={editForm.description ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))} className="text-sm" />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer pb-1">
                  <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm((f: any) => ({ ...f, isActive: e.target.checked }))} />
                  Active
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => updateMut.mutate({ id: editId, data: editForm })}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </CMSLayout>
  );
}

// ─── Levels ────────────────────────────────────────────────────────────────

export function LevelsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: curricula } = useQuery({ queryKey: ["cms-curricula"], queryFn: () => cmsApi.curricula.list() });
  const [selectedCurriculum, setSelectedCurriculum] = useState<number | null>(null);
  const { data: levels, isLoading } = useQuery({
    queryKey: ["cms-levels", selectedCurriculum],
    queryFn: () => cmsApi.levels.list(selectedCurriculum ?? undefined),
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ order: 1 });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const createMut = useMutation({
    mutationFn: () => cmsApi.levels.create({ ...form, curriculumId: selectedCurriculum }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cms-levels"] }); setForm({ order: 1 }); setShowForm(false); toast({ title: "Level created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => cmsApi.levels.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cms-levels"] }); setEditId(null); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CMSLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Levels</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              <strong>Gate %</strong> is how much of a level a student must finish before its
              evaluation unlocks. 100 means every lesson must be passed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedCurriculum?.toString() ?? "all"} onValueChange={v => setSelectedCurriculum(v === "all" ? null : parseInt(v))}>
              <SelectTrigger className="text-sm w-48"><SelectValue placeholder="All curricula" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All curricula</SelectItem>
                {(curricula ?? []).map((c: any) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedCurriculum && <Button size="sm" onClick={() => setShowForm(f => !f)}><Plus className="h-3.5 w-3.5 mr-1" /> Add Level</Button>}
          </div>
        </div>

        {showForm && selectedCurriculum && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Code *</Label>
                <Input value={form.code ?? ""} onChange={e => setForm((f: any) => ({ ...f, code: e.target.value }))} placeholder="A1.1, B2, etc." className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Name (English) *</Label>
                <Input value={form.name ?? ""} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Name (Arabic) *</Label>
                <Input dir="rtl" value={form.nameAr ?? ""} onChange={e => setForm((f: any) => ({ ...f, nameAr: e.target.value }))} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Order *</Label>
                <Input type="number" value={form.order ?? 1} onChange={e => setForm((f: any) => ({ ...f, order: parseInt(e.target.value) }))} className="text-sm" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs text-gray-500">Description</Label>
                <Input value={form.description ?? ""} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} className="text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()}>Create Level</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {isLoading ? <div className="p-6 text-center text-gray-400 text-sm">Loading…</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Order</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Code</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Arabic</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600" title="How much of the level a student must finish before its evaluation unlocks">Gate&nbsp;%</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">Curriculum</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(levels ?? []).map((l: any) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    {editId === l.id ? (
                      <>
                        <td className="px-4 py-2"><Input type="number" value={editForm.order} onChange={e => setEditForm((f: any) => ({ ...f, order: parseInt(e.target.value) }))} className="text-sm h-7 w-16" /></td>
                        <td className="px-4 py-2"><Input value={editForm.code} onChange={e => setEditForm((f: any) => ({ ...f, code: e.target.value }))} className="text-sm h-7" /></td>
                        <td className="px-4 py-2"><Input value={editForm.name} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} className="text-sm h-7" /></td>
                        <td className="px-4 py-2"><Input dir="rtl" value={editForm.nameAr} onChange={e => setEditForm((f: any) => ({ ...f, nameAr: e.target.value }))} className="text-sm h-7" /></td>
                        <td className="px-4 py-2"><Input type="number" min={0} max={100} value={editForm.evaluationUnlockPercent ?? 100} onChange={e => setEditForm((f: any) => ({ ...f, evaluationUnlockPercent: parseInt(e.target.value) }))} className="text-sm h-7 w-16" /></td>
                        <td className="px-4 py-2 hidden md:table-cell">—</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => updateMut.mutate({ id: l.id, data: editForm })} className="p-1 rounded hover:bg-green-50 text-green-600"><Check className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setEditId(null)} className="p-1 rounded hover:bg-red-50 text-red-400 ml-1"><X className="h-3.5 w-3.5" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-gray-400">{l.order}</td>
                        <td className="px-4 py-2.5 font-mono text-indigo-700">{l.code}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-700">{l.name}</td>
                        <td className="px-4 py-2.5">{l.nameAr}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{l.evaluationUnlockPercent ?? 100}%</td>
                        <td className="px-4 py-2.5 hidden md:table-cell text-gray-400 text-xs">{l.curriculumId}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => { setEditId(l.id); setEditForm({ code: l.code, name: l.name, nameAr: l.nameAr, order: l.order, description: l.description, evaluationUnlockPercent: l.evaluationUnlockPercent ?? 100 }); }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-500"><Pencil className="h-3.5 w-3.5" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </CMSLayout>
  );
}
