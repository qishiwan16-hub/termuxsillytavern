import type { MultipartFile } from "@fastify/multipart";

export interface UploadedBuffer {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

export async function readMultipartToBuffer(file: MultipartFile): Promise<UploadedBuffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk as Buffer);
  }
  return {
    filename: file.filename,
    mimetype: file.mimetype,
    buffer: Buffer.concat(chunks)
  };
}
