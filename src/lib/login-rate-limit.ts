import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { PrismaClient } from "../generated/prisma/client.ts";

export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_SOURCE_LIMIT = 150;
export const LOGIN_RETRY_AFTER = 300;

export function loginRateLimitKeys(headers: Headers, email: string, config: {
  production: boolean; secret?: string; trustedHeader?: string;
}) {
  const { production, secret, trustedHeader } = config;
  if (production && (!secret || Buffer.byteLength(secret) < 32 || !trustedHeader)) {
    throw new Error("Login rate limit is not configured.");
  }
  const key = (scope: string, value: string) => {
    const digest = secret ? createHmac("sha256", secret) : createHash("sha256");
    return digest.update(scope + "\0" + value).digest("hex");
  };
  let source: string | undefined;
  if (trustedHeader) {
    const address = headers.get(trustedHeader)?.trim() ?? "";
    const version = isIP(address);
    if (!version || address.includes("%")) throw new Error("Trusted client address is unavailable.");
    source = key("source", version === 6 ? new URL(`http://[${address}]`).hostname : address);
  }
  return { account: key("account", email), source };
}

export function createLoginRateLimitStore(db: PrismaClient) {
  return {
    async reserve(key: string, limit: number) {
      const [reservation] = await db.$queryRaw<{ windowEnd: Date }[]>`
        INSERT INTO "LoginAttemptBucket" ("key", "windowEnd", "attempts")
        VALUES (${key}, date_bin(interval '5 minutes', statement_timestamp(), timestamptz '2000-01-01 00:00:00Z')
          + interval '5 minutes', 1)
        ON CONFLICT ("key", "windowEnd") DO UPDATE SET "attempts" = "LoginAttemptBucket"."attempts" + 1
        WHERE "LoginAttemptBucket"."attempts" < ${limit}
        RETURNING "windowEnd"
      `;
      return reservation?.windowEnd ?? null;
    },

    async release(key: string, windowEnd: Date) {
      await db.loginAttemptBucket.updateMany({
        where: { key, windowEnd, attempts: { gt: 0 } },
        data: { attempts: { decrement: 1 } },
      });
    },

    async pruneExpired() {
      await db.$executeRaw`
        DELETE FROM "LoginAttemptBucket"
        WHERE ("key", "windowEnd") IN (
          SELECT "key", "windowEnd" FROM "LoginAttemptBucket"
          WHERE "windowEnd" <= statement_timestamp()
          ORDER BY "windowEnd"
          LIMIT 200
          FOR UPDATE SKIP LOCKED
        )
      `;
    },
  };
}
