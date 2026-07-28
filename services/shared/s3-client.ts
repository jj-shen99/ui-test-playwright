/**
 * S3-compatible object storage client (MinIO locally, S3 in prod).
 * Used for storing test artifacts: traces, videos, screenshots, logs.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";
const S3_BUCKET = process.env.S3_BUCKET || "test-artifacts";
const S3_REGION = process.env.S3_REGION || "us-east-1";

export const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

/** Upload a file to object storage and return the object URI */
export async function uploadArtifact(
  filePath: string,
  runId: string,
  testId: string,
  kind: string
): Promise<string> {
  const ext = path.extname(filePath);
  const key = `runs/${runId}/${testId}/${kind}-${randomUUID()}${ext}`;

  const fileContent = fs.readFileSync(filePath);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: getContentType(ext),
    })
  );

  return `s3://${S3_BUCKET}/${key}`;
}

/** Get a pre-signed URL for downloading an artifact */
export async function getArtifactUrl(objectUri: string): Promise<string> {
  const match = objectUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid object URI: ${objectUri}`);

  const [, bucket, key] = match;
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    ".zip": "application/zip",
    ".webm": "video/webm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".txt": "text/plain",
    ".log": "text/plain",
  };
  return types[ext] || "application/octet-stream";
}
