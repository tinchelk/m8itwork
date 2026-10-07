ALTER TABLE "ReviewJob" ADD COLUMN "comparisonId" UUID;
CREATE UNIQUE INDEX "ReviewJob_comparisonId_provider_key" ON "ReviewJob"("comparisonId", "provider");
-- The queue lock still admits one run per project. A comparison is one run
-- containing one job per provider; keep a database fence against duplicate work.
DROP INDEX "ReviewJob_active_project";
CREATE UNIQUE INDEX "ReviewJob_active_project_provider" ON "ReviewJob"("projectId", "provider") WHERE "status" IN ('QUEUED','RUNNING');
