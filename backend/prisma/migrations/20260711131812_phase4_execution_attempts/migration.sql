-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_executions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "proposalId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "firedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "n8nWebhook" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "executions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_executions" ("firedAt", "id", "n8nWebhook", "proposalId", "requestPayloadHash", "responseBody", "responseStatus") SELECT "firedAt", "id", "n8nWebhook", "proposalId", "requestPayloadHash", "responseBody", "responseStatus" FROM "executions";
DROP TABLE "executions";
ALTER TABLE "new_executions" RENAME TO "executions";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
