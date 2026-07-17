import jwt from "jsonwebtoken";
import { env } from "../env";

export type JwtRole = "operator" | "wallboard";

export type JwtPayload = {
  sub: string;
  role: JwtRole;
};

export function signJwt(payload: JwtPayload) {
  const token = jwt.sign(payload, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: "HS256",
    expiresIn: "12h"
  });

  return token;
}

