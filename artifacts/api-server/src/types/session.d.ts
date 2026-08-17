import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "student" | "admin";
    name: string;
    email: string;
  }
}
