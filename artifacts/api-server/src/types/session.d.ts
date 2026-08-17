import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "student" | "admin" | "content_manager" | "content_reviewer";
    name: string;
    email: string;
  }
}
