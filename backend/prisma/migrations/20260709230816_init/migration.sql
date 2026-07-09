-- CreateTable
CREATE TABLE "clients_cache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "lastSyncedAt" DATETIME NOT NULL,
    "rawSnapshot" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organizationId" TEXT NOT NULL,
    "preferencesMd" TEXT NOT NULL DEFAULT '',
    "revisionPatternsMd" TEXT NOT NULL DEFAULT '',
    "churnRisk" TEXT NOT NULL DEFAULT 'low',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "metrics_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "rawOverview" TEXT NOT NULL,
    "activeClients" INTEGER,
    "tasksStuck" INTEGER,
    "creditsDeducted" INTEGER,
    "parsedNumbers" TEXT
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "titleAr" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "proposedActionJson" TEXT NOT NULL,
    "organizationId" TEXT
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "proposalId" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" TEXT NOT NULL,
    "noteAr" TEXT,
    CONSTRAINT "approvals_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "executions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "proposalId" TEXT NOT NULL,
    "firedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "n8nWebhook" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    CONSTRAINT "executions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decision_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "summaryAr" TEXT NOT NULL,
    "refs" TEXT
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostUsd" REAL NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_cache_organizationId_key" ON "clients_cache"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_organizationId_key" ON "client_profiles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_proposalId_key" ON "approvals"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "executions_proposalId_key" ON "executions"("proposalId");
