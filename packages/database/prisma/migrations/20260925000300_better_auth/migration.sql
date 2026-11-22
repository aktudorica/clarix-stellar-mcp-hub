-- Additive migration. Existing IDs, password hashes, memberships and legacy sessions survive.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "image" TEXT, ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE "AuthAccount" (
 "id" UUID PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "password" TEXT, "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
 "accessTokenExpiresAt" TIMESTAMP(3), "refreshTokenExpiresAt" TIMESTAMP(3), "scope" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AuthAccount_providerId_accountId_key" ON "AuthAccount"("providerId", "accountId");
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");
CREATE TABLE "AuthSession" (
 "id" UUID PRIMARY KEY, "token" TEXT NOT NULL UNIQUE,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "expiresAt" TIMESTAMP(3) NOT NULL, "ipAddress" TEXT, "userAgent" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE TABLE "AuthVerification" (
 "id" UUID PRIMARY KEY, "identifier" TEXT NOT NULL, "value" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");
INSERT INTO "AuthAccount" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id"::text, 'credential', "id", "passwordHash", "createdAt", CURRENT_TIMESTAMP
FROM "User" WHERE "passwordHash" IS NOT NULL;
