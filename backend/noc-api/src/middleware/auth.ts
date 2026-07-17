import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env";
import type { JwtPayload, JwtRole } from "../auth/jwt";

export type AuthenticatedRequest = Request & { auth?: { role: JwtRole; sub: string } };

export function requireJwt(allowedRoles: JwtRole[]) {
  return function (req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const token = authHeader.slice("Bearer ".length);
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE
      }) as JwtPayload;

      if (!allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      req.auth = { role: decoded.role, sub: decoded.sub };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

