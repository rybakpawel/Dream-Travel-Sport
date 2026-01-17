import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

const BUCKET_NAME = "trip-images";

export interface StorageService {
  uploadImage(file: Buffer, filename: string, contentType: string): Promise<string>;
  deleteImage(path: string): Promise<void>;
  getPublicUrl(path: string): string;
}

class SupabaseStorageService implements StorageService {
  private client: SupabaseClient;
  private bucketName: string;

  constructor(env: Env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    this.bucketName = BUCKET_NAME;
  }

  async uploadImage(file: Buffer, filename: string, contentType: string): Promise<string> {
    // Wygeneruj unikalną nazwę pliku
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(8).toString("hex");
    const ext = filename.split(".").pop() || "jpg";
    const uniqueFilename = `${timestamp}-${randomSuffix}.${ext}`;
    const filePath = `trips/${uniqueFilename}`;

    // Upload do Supabase Storage
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .upload(filePath, file, {
        contentType,
        upsert: false
      });

    if (error) {
      throw new Error(`Failed to upload image to Supabase: ${error.message}`);
    }

    // Zwróć publiczny URL
    return this.getPublicUrl(data.path);
  }

  async deleteImage(path: string): Promise<void> {
    // Wyciągnij ścieżkę z URL-a (np. "https://...supabase.co/storage/v1/object/public/trip-images/trips/file.jpg" -> "trips/file.jpg")
    let filePath = path;
    
    // Jeśli to pełny URL, wyciągnij ścieżkę
    if (path.includes("/storage/v1/object/public/")) {
      const parts = path.split("/storage/v1/object/public/");
      if (parts.length > 1) {
        filePath = parts[1].replace(`${this.bucketName}/`, "");
      }
    } else if (path.startsWith("/")) {
      // Jeśli zaczyna się od /, usuń pierwszy slash
      filePath = path.substring(1);
    } else if (path.startsWith("trips/")) {
      // Już w formacie trips/filename
      filePath = path;
    }

    const { error } = await this.client.storage.from(this.bucketName).remove([filePath]);

    if (error) {
      // Nie rzucaj błędu jeśli plik nie istnieje (może być już usunięty)
      if (error.message.includes("not found") || error.message.includes("does not exist")) {
        console.warn(`[storage] Image not found for deletion: ${filePath}`);
        return;
      }
      throw new Error(`Failed to delete image from Supabase: ${error.message}`);
    }
  }

  getPublicUrl(path: string): string {
    // Wyciągnij ścieżkę z URL-a jeśli to pełny URL
    let filePath = path;
    
    if (path.includes("/storage/v1/object/public/")) {
      const parts = path.split("/storage/v1/object/public/");
      if (parts.length > 1) {
        filePath = parts[1].replace(`${this.bucketName}/`, "");
      }
    } else if (path.startsWith("/")) {
      filePath = path.substring(1);
    }

    const { data } = this.client.storage.from(this.bucketName).getPublicUrl(filePath);
    return data.publicUrl;
  }
}

class LocalStorageService implements StorageService {
  private baseUrl: string;

  constructor(env: Env) {
    // W dev, użyj lokalnego URL
    this.baseUrl = env.SERVER_PUBLIC_URL || `http://localhost:${env.PORT}`;
  }

  async uploadImage(_file: Buffer, _filename: string, _contentType: string): Promise<string> {
    throw new Error("Local storage not implemented - use Supabase Storage");
  }

  async deleteImage(_path: string): Promise<void> {
    throw new Error("Local storage not implemented - use Supabase Storage");
  }

  getPublicUrl(path: string): string {
    // Jeśli już jest pełny URL, zwróć bez zmian
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    // W przeciwnym razie, dodaj base URL
    return `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }
}

export function createStorageService(env: Env): StorageService {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseStorageService(env);
  }
  return new LocalStorageService(env);
}

