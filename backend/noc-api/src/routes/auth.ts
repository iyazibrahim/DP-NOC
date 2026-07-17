import type { Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { env } from "../env";
import { signJwt } from "../auth/jwt";
import { requireJwt } from "../middleware/auth";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const authRouter = express.Router();

authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { username, password } = parsed.data;
  if (
    username !== env.OPERATOR_USERNAME ||
    password !== env.OPERATOR_PASSWORD
  ) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signJwt({ sub: username, role: "operator" });
  return res.json({ token });
});

// Wallboard in v1 reuses operator JWT role.
authRouter.get("/me", requireJwt(["operator", "wallboard"]), async (req: any, res) => {
  return res.json({ sub: req.auth?.sub, role: req.auth?.role });
});

