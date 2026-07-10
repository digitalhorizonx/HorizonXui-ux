-- CreateTable
CREATE TABLE "profile_updates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organizationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "diffJson" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_client_profiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organizationId" TEXT NOT NULL,
    "preferencesMd" TEXT NOT NULL DEFAULT '',
    "revisionPatternsMd" TEXT NOT NULL DEFAULT '',
    "churnRisk" TEXT NOT NULL DEFAULT 'low',
    "churnRiskReasonAr" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_client_profiles" ("churnRisk", "id", "organizationId", "preferencesMd", "revisionPatternsMd", "updatedAt") SELECT "churnRisk", "id", "organizationId", "preferencesMd", "revisionPatternsMd", "updatedAt" FROM "client_profiles";
DROP TABLE "client_profiles";
ALTER TABLE "new_client_profiles" RENAME TO "client_profiles";
CREATE UNIQUE INDEX "client_profiles_organizationId_key" ON "client_profiles"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
