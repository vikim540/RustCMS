/**
 * 前端圖片壓縮引擎 — 基於 browser-image-compression（Web Worker + WASM 級別壓縮質量）
 *
 * 設計原則（組件化管理）：
 *   - 此文件是唯一的壓縮引擎入口，對外接口固定（CompressResult / compressImage）
 *   - 替換引擎時只需修改此文件，ImageCompressDialog / useImageUpload 等消費方無需改動
 *   - 底層使用 browser-image-compression（Web Worker 不阻塞 UI，自動 EXIF 旋轉修正）
 *
 * 引擎特性：
 *   - 自動按最大尺寸等比縮放（不變形）
 *   - 轉換為 WebP 格式（體積減少 30-70%）
 *   - 可配置壓縮質量（0-1，默認 0.82）
 *   - Web Worker 壓縮（不阻塞主線程）
 *   - 自動 EXIF 方向修正
 *   - 壓縮進度回調
 */

import imageCompression from 'browser-image-compression';

/** 輸出格式 */
export type CompressFormat = 'webp' | 'original';

/** 壓縮選項 */
export interface CompressOptions {
  /** 最大邊長（px）— 圖片最長邊不超過此值，按原始比例等比縮放，不會拉伸變形。默認 1920 */
  maxDimension?: number;
  /** @deprecated 已由 maxDimension 取代，保留向後兼容。最大寬度（px），默認 1920 */
  maxWidth?: number;
  /** @deprecated 已由 maxDimension 取代，保留向後兼容。最大高度（px），默認 1080 */
  maxHeight?: number;
  /** 壓縮質量 0-1，默認 0.82（視覺無損） */
  quality?: number;
  /** 輸出格式，默認 webp */
  format?: CompressFormat;
  /** 輸出文件名前綴（默認保留原名） */
  filename?: string;
  /** 壓縮進度回調（0-100） */
  onProgress?: (progress: number) => void;
}

/** 壓縮結果（含尺寸和預覽信息） */
export interface CompressResult {
  /** 壓縮後的 File 對象 */
  file: File;
  /** 壓縮後的預覽 URL（ObjectURL，需手動釋放） */
  previewUrl: string;
  /** 壓縮後寬度 */
  width: number;
  /** 壓縮後高度 */
  height: number;
  /** 壓縮後大小（字節） */
  size: number;
  /** 原始大小（字節） */
  originalSize: number;
  /** 節省比例 0-1 */
  savings: number;
  /** 輸出 MIME 類型 */
  type: string;
}

/** 默認壓縮參數 */
const DEFAULTS: Required<Omit<CompressOptions, 'onProgress' | 'maxWidth' | 'maxHeight'>> = {
  maxDimension: 1920,
  quality: 0.82,
  format: 'webp',
  filename: '',
};

/** 判斷文件是否為可壓縮的圖片格式 */
function isCompressibleImage(file: File): boolean {
  if (!file.type.startsWith('image/')) return false;
  // SVG 是矢量圖，無需壓縮
  if (file.type === 'image/svg+xml') return false;
  return true;
}

/** 獲取圖片尺寸 */
async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  try {
    const img = new Image();
    const url = URL.createObjectURL(file);
    return await new Promise((resolve) => {
      img.onload = () => {
        const result = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(result);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      img.src = url;
    });
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * 壓縮圖片文件並返回完整結果（含預覽 URL、尺寸、大小對比）
 *
 * 底層使用 browser-image-compression（Web Worker 壓縮，不阻塞 UI）
 *
 * @param file 原始圖片文件
 * @param options 壓縮選項
 * @returns CompressResult 壓縮結果
 */
export async function compressImage(
  file: File,
  options?: CompressOptions,
): Promise<CompressResult> {
  const opts = { ...DEFAULTS, ...options };
  const originalSize = file.size;

  // 非圖片或 SVG 直接返回原文件
  if (!isCompressibleImage(file)) {
    return {
      file,
      previewUrl: URL.createObjectURL(file),
      width: 0,
      height: 0,
      size: originalSize,
      originalSize,
      savings: 0,
      type: file.type,
    };
  }

  try {
    // 構建 browser-image-compression 選項
    const outputType = opts.format === 'webp' ? 'image/webp' : file.type || 'image/png';
    // 使用 maxDimension 作為最大邊長（按原始比例等比縮放，不會拉伸變形）
    // 向後兼容：若未設置 maxDimension，則取 maxWidth/maxHeight 的較大值
    const maxWidthOrHeight = opts.maxDimension
      || Math.max(opts.maxWidth ?? 1920, opts.maxHeight ?? 1080);

    const compressOptions = {
      maxSizeMB: 50, // 上限 50MB（基本不會觸及，主要由質量控制）
      maxWidthOrHeight,
      useWebWorker: true, // 使用 Web Worker，不阻塞主線程
      fileType: outputType,
      initialQuality: opts.quality,
      onProgress: opts.onProgress,
    };

    // 執行壓縮
    const compressedFile = await imageCompression(file, compressOptions);

    // 如果壓縮後反而變大，使用原文件
    const finalFile = compressedFile.size >= originalSize ? file : compressedFile;
    const finalSize = finalFile.size;

    // 生成文件名
    const baseName = opts.filename || file.name.replace(/\.[^.]+$/, '');
    const ext = opts.format === 'webp' ? 'webp' : (file.name.split('.').pop() || 'png');
    const outputName = `${baseName}.${ext}`;

    // 確保 File 對象有正確的文件名和類型
    const namedFile = finalFile.name === outputName && finalFile.type === outputType
      ? finalFile
      : new File([finalFile], outputName, { type: outputType });

    // 獲取壓縮後的圖片尺寸
    const { width, height } = await getImageDimensions(namedFile);

    return {
      file: namedFile,
      previewUrl: URL.createObjectURL(namedFile),
      width,
      height,
      size: finalSize,
      originalSize,
      savings: originalSize > 0 ? 1 - finalSize / originalSize : 0,
      type: outputType,
    };
  } catch (e) {
    console.warn('圖片壓縮失敗，使用原文件:', e);
    return {
      file,
      previewUrl: URL.createObjectURL(file),
      width: 0,
      height: 0,
      size: originalSize,
      originalSize,
      savings: 0,
      type: file.type,
    };
  }
}

/**
 * 壓縮圖片文件，僅返回 File 對象（簡便方法）
 *
 * @param file 原始圖片文件
 * @param options 壓縮選項
 * @returns 壓縮後的 File 對象
 */
export async function compressImageToWebP(
  file: File,
  options?: CompressOptions,
): Promise<File> {
  const result = await compressImage(file, options);
  return result.file;
}

/**
 * 批量壓縮圖片文件
 * @param files 原始圖片文件數組
 * @param options 壓縮選項
 * @returns 壓縮結果數組
 */
export async function compressImagesBatch(
  files: File[],
  options?: CompressOptions,
): Promise<CompressResult[]> {
  return Promise.all(files.map((f) => compressImage(f, options)));
}

/** 格式化文件大小為人類可讀字符串 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 獲取圖片的原始尺寸
 * @param url 圖片 URL
 * @returns { width, height }
 */
export function getImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}
