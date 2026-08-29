import { useGetAdminLessons } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { Link } from "wouter";

export default function AdminLessons() {
  const { data: lessons, isLoading, error } = useGetAdminLessons();

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !lessons) {
    return (
      <div className="p-8 text-center text-destructive">
        حدث خطأ أثناء تحميل بيانات الدروس
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">المنهج والدروس</h1>
          <p className="text-muted-foreground mt-1">إدارة المحتوى التعليمي للمنصة</p>
        </div>
        <Button asChild>
          <Link href="/cms/lessons/new">
            <Plus className="mr-2 h-4 w-4" />
            إضافة درس جديد
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right w-16">المعرف</TableHead>
                <TableHead className="text-right">عنوان الدرس</TableHead>
                <TableHead className="text-right">النوع</TableHead>
                <TableHead className="text-right">المدة المتوقعة</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-center w-24">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.map((lesson) => (
                <TableRow key={lesson.id}>
                  <TableCell className="font-mono text-muted-foreground">{lesson.id}</TableCell>
                  <TableCell>
                    <div className="font-bold text-foreground">{lesson.titleAr}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{lesson.title}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{lesson.lessonType}</Badge>
                  </TableCell>
                  <TableCell>{lesson.estimatedMinutes} دقيقة</TableCell>
                  <TableCell>
                    {lesson.isPublished ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">منشور</Badge>
                    ) : (
                      <Badge variant="secondary">مسودة</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/cms/lessons/${lesson.id}/edit`}>تعديل</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {lessons.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    لا يوجد دروس لعرضها
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
