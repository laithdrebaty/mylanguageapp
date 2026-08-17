import { type Request, type Response, type NextFunction } from "express";

/** Any authenticated user (all roles). */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/** Admin only. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.session?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

/**
 * Admin + content_manager.
 * Used for content creation and editing endpoints.
 */
export function requireContentManager(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const role = req.session?.role;
  if (role !== "admin" && role !== "content_manager") {
    res.status(403).json({ error: "Content manager access required" });
    return;
  }
  next();
}

/**
 * Admin + content_manager + content_reviewer.
 * Used for read-access to CMS content (listings, preview, audit log).
 */
export function requireCMSAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const role = req.session?.role;
  if (role !== "admin" && role !== "content_manager" && role !== "content_reviewer") {
    res.status(403).json({ error: "CMS access required" });
    return;
  }
  next();
}

/**
 * Admin + content_reviewer.
 * Used for review decisions (approve/reject).
 */
export function requireReviewer(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const role = req.session?.role;
  if (role !== "admin" && role !== "content_reviewer") {
    res.status(403).json({ error: "Reviewer access required" });
    return;
  }
  next();
}
