import { useState } from "react";
import { useGetAdminStudents } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export default function AdminStudents() {
  const [page, setPage] = useState(1);
  const limit = 10;
  
  const { data, isLoading, error } = useGetAdminStudents({ page, limit });

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-destructive">
        حدث خطأ أثناء تحميل بيانات الطلاب
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-foreground">الطلاب</h1>
        <div className="text-sm font-medium text-muted-foreground bg-secondary px-3 py-1 rounded-full">
          الإجمالي: {data.total}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الاسم</TableHead>
                <TableHead className="text-right">البريد الإلكتروني</TableHead>
                <TableHead className="text-right">البلد</TableHead>
                <TableHead className="text-right">تاريخ الانضمام</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="font-medium">{student.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono" dir="ltr">{student.email}</TableCell>
                  <TableCell>{student.country || "-"}</TableCell>
                  <TableCell>
                    {format(new Date(student.createdAt), "d MMM yyyy", { locale: ar })}
                  </TableCell>
                </TableRow>
              ))}
              {data.students.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    لا يوجد طلاب لعرضهم
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.total > limit && (
        <div className="flex justify-between items-center bg-card p-4 rounded-xl border border-border">
          <Button 
            variant="outline" 
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            السابق
          </Button>
          <span className="text-sm text-muted-foreground font-medium">
            صفحة {page} من {Math.ceil(data.total / limit)}
          </span>
          <Button 
            variant="outline" 
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(data.total / limit)}
          >
            التالي
          </Button>
        </div>
      )}
    </div>
  );
}
