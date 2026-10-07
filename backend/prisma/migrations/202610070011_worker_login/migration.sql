ALTER TABLE "ReviewWorker" ADD COLUMN "remoteLogin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "loginRequest" JSONB;
